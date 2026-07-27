# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Plugin listing detail -- response classes and handler for the GET /plugin/list route."""

import logging
from functools import partial

from fiab_core.fable import PluginCompositeId
from fiab_core.plugin import Plugin
from pydantic import Field

from forecastbox.domain.plugin.db import PluginStateRecord, get_all_plugin_states
from forecastbox.domain.plugin.errors import PluginError, PluginErrors
from forecastbox.domain.plugin.exceptions import PluginManagerBusy
from forecastbox.domain.plugin.manager import PluginManager
from forecastbox.domain.plugin.store import PluginRemoteInfo, PluginStoreEntry, get_plugins_detail
from forecastbox.utility.concurrency.manager import TaskName, execution_manager
from forecastbox.utility.concurrency.synchronization import timed_acquire
from forecastbox.utility.config import ConcurrentPools
from forecastbox.utility.pydantic import FiabBaseModel
from forecastbox.utility.time import value_dt2str

logger = logging.getLogger(__name__)


class PluginGenericData(FiabBaseModel):
    store_info: PluginStoreEntry | None = None
    remote_info: PluginRemoteInfo | None = None


class PluginInstallSettings(FiabBaseModel):
    isEnabled: bool
    excluded_templates: list[str]
    included_templates: list[str]
    glyph_remapping: dict[str, str]


class PluginInstallData(FiabBaseModel):
    local_version: str
    update_datetime: str
    install_errors: PluginErrors


class PluginDetail(FiabBaseModel):
    generic_data: PluginGenericData
    install_data: PluginInstallData | None = None
    settings_data: PluginInstallSettings | None = None
    load_errors: PluginErrors = Field(default_factory=lambda: PluginErrors([]))


class PluginListing(FiabBaseModel):
    plugins: dict[PluginCompositeId, PluginDetail]


def _install_failed(install_errors: PluginErrors) -> bool:
    return any(e.severity in ("error", "critical") for e in install_errors)


def _build_detail(
    plugin_id: PluginCompositeId,
    store_entry: PluginStoreEntry | None,
    remote_info: PluginRemoteInfo | None,
    plugin_in_memory: Plugin | None,
    in_memory_errors: PluginErrors,
    db_state: PluginStateRecord | None,
) -> PluginDetail:
    generic_data = PluginGenericData(store_info=store_entry, remote_info=remote_info)

    if db_state is None:
        if in_memory_errors:
            logger.warning(
                f"plugin {PluginCompositeId.to_str(plugin_id)!r} has in-memory errors but no DB state; "
                "this is unexpected -- errors will not be surfaced"
            )
        return PluginDetail(generic_data=generic_data)

    all_db_errors = PluginErrors([PluginError(**e) for e in db_state.plugin_errors])
    install_errors = PluginErrors([e for e in all_db_errors if e.source == "install"])
    db_load_errors = PluginErrors([e for e in all_db_errors if e.source != "install"])
    install_data = PluginInstallData(
        local_version=db_state.plugin_version,
        update_datetime=value_dt2str(db_state.updated_at),
        install_errors=install_errors,
    )

    settings_data = None
    if not _install_failed(install_errors):
        is_enabled = db_state.enabled
        excluded = list(db_state.excluded_templates)
        excluded_set = set(excluded)
        if plugin_in_memory is not None and is_enabled:
            all_names = [t.display_name for t in plugin_in_memory.blueprint_templates]
            included = [n for n in all_names if n not in excluded_set]
        else:
            included = []
        settings_data = PluginInstallSettings(
            isEnabled=is_enabled,
            excluded_templates=excluded,
            included_templates=included,
            glyph_remapping=dict(db_state.glyph_remapping),
        )

    load_error_list: list[PluginError] = list(db_load_errors) + list(in_memory_errors)
    if db_state.template_errors:
        load_error_list += [
            PluginError(source="template_ingest", severity="warning", detail=f"template {name!r}: {msg}")
            for name, msg in db_state.template_errors.items()
        ]

    return PluginDetail(
        generic_data=generic_data,
        install_data=install_data,
        settings_data=settings_data,
        load_errors=PluginErrors(load_error_list),
    )


async def build_plugin_listing() -> PluginListing:
    """Build and return the full plugin listing."""
    with timed_acquire(PluginManager.lock, 0.5) as acquired:
        if not acquired:
            raise PluginManagerBusy("plugin manager lock could not be acquired; retry later")
        plugins_snapshot: dict[PluginCompositeId, Plugin] = dict(PluginManager.plugins)
        errors_snapshot: dict[PluginCompositeId, PluginErrors] = dict(PluginManager.errors)
        db_states = await execution_manager.awaitable_submit(
            ConcurrentPools.JobsDb,
            TaskName("plugin.state.list"),
            partial(get_all_plugin_states),
        )

    store_detail = get_plugins_detail()

    states_by_id: dict[PluginCompositeId, PluginStateRecord] = {}
    for state in db_states:
        try:
            pid = PluginCompositeId.from_str(state.plugin_id)
        except Exception:
            logger.warning(f"could not parse plugin_id {state.plugin_id!r} from DB; skipping")
            continue
        states_by_id[pid] = state

    all_ids = set(store_detail.keys()) | set(states_by_id.keys()) | set(plugins_snapshot.keys())

    plugins: dict[PluginCompositeId, PluginDetail] = {}
    for plugin_id in all_ids:
        store_entry: PluginStoreEntry | None = None
        remote_info: PluginRemoteInfo | None = None
        if plugin_id in store_detail:
            store_entry, remote_info = store_detail[plugin_id]

        plugins[plugin_id] = _build_detail(
            plugin_id=plugin_id,
            store_entry=store_entry,
            remote_info=remote_info,
            plugin_in_memory=plugins_snapshot.get(plugin_id),
            in_memory_errors=errors_snapshot.get(plugin_id, PluginErrors([])),
            db_state=states_by_id.get(plugin_id),
        )

    return PluginListing(plugins=plugins)

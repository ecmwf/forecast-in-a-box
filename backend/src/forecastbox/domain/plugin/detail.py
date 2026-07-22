# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Plugin listing detail -- response classes and handler for the GET /plugin/list route.

These classes are both frontend-exposed (serialised as JSON in HTTP responses) and
consumed internally by the service layer.  Changes to field names or structure affect
the frontend contract; coordinate with frontend consumers before making breaking changes.

The public entry-point is ``build_plugin_listing()``.  It acquires the PluginManager
lock for the duration of the in-memory snapshot capture *and* the database reads, so
that both are taken from the same logical point in time.  This is not a fully
transactional read (the SQLite reads are not inside a DB transaction), but it is
sufficient for a consistent UI snapshot.  The lock is held only for the duration of
these fast operations; long-running work must not be done under it.
"""

import logging

from fiab_core.fable import PluginCompositeId
from fiab_core.plugin import Plugin
from pydantic import Field

from forecastbox.domain.plugin.db import get_all_plugin_states
from forecastbox.domain.plugin.errors import PluginError, PluginErrors
from forecastbox.domain.plugin.exceptions import PluginManagerBusy
from forecastbox.domain.plugin.manager import PluginManager
from forecastbox.domain.plugin.store import PluginRemoteInfo, PluginStoreEntry, get_plugins_detail
from forecastbox.schemata.jobs import PluginState
from forecastbox.utility.concurrency.synchronization import timed_acquire
from forecastbox.utility.pydantic import FiabBaseModel
from forecastbox.utility.time import value_dt2str

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Response model hierarchy
# ---------------------------------------------------------------------------


class PluginGenericData(FiabBaseModel):
    store_info: PluginStoreEntry | None = None
    """Info about the plugin from the respective store. None if the plugin was configured
    outside of any store (e.g. direct config edit without going through the install flow)."""
    remote_info: PluginRemoteInfo | None = None
    """Dynamic remote information such as the most recent published version. None if the
    plugin is an install from a local path or if no remote data is available."""


class PluginInstallSettings(FiabBaseModel):
    isEnabled: bool
    """Whether the user configured the plugin to be loaded."""
    excluded_templates: list[str]
    """Templates the user configured to be excluded. Empty list if none configured."""
    included_templates: list[str]
    """Templates that are available for use. If the plugin is disabled or not loaded, this is an empty list."""
    glyph_remapping: dict[str, str]
    """Glyph remapping the user applied during installation. Empty map if disabled or not configured."""


class PluginInstallData(FiabBaseModel):
    local_version: str
    """The installed version, as declared by the python package."""
    update_datetime: str
    """The most recent update datetime -- when was the python package locally modified."""
    install_errors: PluginErrors
    """Errors that appear exclusively during the install phase. If any entry has a severity
    higher than warning, the install has failed and the plugin cannot be used."""


class PluginDetail(FiabBaseModel):
    generic_data: PluginGenericData
    """Always available for every configured plugin, regardless of its status."""
    install_data: PluginInstallData | None = None
    """Available only if the plugin was installed (i.e. a DB record exists).
    Contains possible error messages from the installation phase."""
    settings_data: PluginInstallSettings | None = None
    """Available only if the plugin was successfully installed (no install-phase errors
    of severity error or critical)."""
    load_errors: PluginErrors = Field(default_factory=lambda: PluginErrors([]))
    """Load and template-ingestion errors accumulated since the last successful install.
    Always a list; non-empty only when the plugin is installed and enabled. Maximum
    severity determines whether the plugin can be used."""


class PluginListing(FiabBaseModel):
    plugins: dict[PluginCompositeId, PluginDetail]


# ---------------------------------------------------------------------------
# Listing builder
# ---------------------------------------------------------------------------


def _install_failed(install_errors: PluginErrors) -> bool:
    """Return True if any install error has severity error or critical."""
    return any(e.severity in ("error", "critical") for e in install_errors)


def _build_detail(
    plugin_id: PluginCompositeId,
    store_entry: PluginStoreEntry | None,
    remote_info: PluginRemoteInfo | None,
    plugin_in_memory: Plugin | None,
    in_memory_errors: PluginErrors,
    db_state: PluginState | None,
) -> PluginDetail:
    generic_data = PluginGenericData(store_info=store_entry, remote_info=remote_info)

    if db_state is None:
        if in_memory_errors:
            logger.warning(
                f"plugin {PluginCompositeId.to_str(plugin_id)!r} has in-memory errors but no DB state; "
                "this is unexpected -- errors will not be surfaced"
            )
        return PluginDetail(generic_data=generic_data)

    # Separate persisted errors by source: install-phase errors go to install_data,
    # load/template_ingest errors go to load_errors.
    all_db_errors = PluginErrors([PluginError(**e) for e in (db_state.plugin_errors or [])])  # type: ignore[union-attr]
    install_errors = PluginErrors([e for e in all_db_errors if e.source == "install"])
    db_load_errors = PluginErrors([e for e in all_db_errors if e.source != "install"])
    install_data = PluginInstallData(
        local_version=db_state.plugin_version,  # type: ignore[attr-defined]
        update_datetime=value_dt2str(db_state.updated_at),  # type: ignore[attr-defined]
        install_errors=install_errors,
    )

    # settings_data -- only if install succeeded
    settings_data = None
    if not _install_failed(install_errors):
        is_enabled = bool(db_state.enabled)  # type: ignore[attr-defined]
        excluded: list[str] = list(db_state.excluded_templates) if db_state.excluded_templates else []  # type: ignore[union-attr]
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
            glyph_remapping=dict(db_state.glyph_remapping) if db_state.glyph_remapping else {},  # type: ignore[arg-type]
        )

    # load_errors -- db non-install errors + in-memory errors + template-ingest errors from DB
    load_error_list: list[PluginError] = list(db_load_errors) + list(in_memory_errors)
    if db_state.template_errors:  # type: ignore[truthy-bool]
        load_error_list += [
            PluginError(source="template_ingest", severity="warning", detail=f"template {name!r}: {msg}")
            for name, msg in db_state.template_errors.items()  # type: ignore[union-attr]
        ]

    return PluginDetail(
        generic_data=generic_data,
        install_data=install_data,
        settings_data=settings_data,
        load_errors=PluginErrors(load_error_list),
    )


async def build_plugin_listing() -> PluginListing:
    """Build and return the full plugin listing.

    Acquires the PluginManager lock, captures in-memory plugin and error snapshots,
    then performs all DB reads while still holding the lock to ensure a consistent
    view.  Raises ``PluginManagerBusy`` if the lock cannot be acquired within the
    timeout, which the route layer translates to a 503 response.
    """
    with timed_acquire(PluginManager.lock, 0.5) as acquired:
        if not acquired:
            raise PluginManagerBusy("plugin manager lock could not be acquired; retry later")
        plugins_snapshot: dict[PluginCompositeId, Plugin] = dict(PluginManager.plugins)
        errors_snapshot: dict[PluginCompositeId, PluginErrors] = dict(PluginManager.errors)
        db_states = await get_all_plugin_states()

    store_detail = get_plugins_detail()

    # Index DB states by parsed PluginCompositeId
    states_by_id: dict[PluginCompositeId, PluginState] = {}
    for state in db_states:
        try:
            pid = PluginCompositeId.from_str(state.plugin_id)  # type: ignore[arg-type]
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

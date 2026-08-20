# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Plugin management routes — /plugin/*. Corresponds to `domain.plugin` submodule.

Contains:
 - one operational route for status of the plugin installer module status,
 - complete CRUD+List routes for the Plugin entity.
"""

import logging
from functools import partial
from typing import Annotated, cast

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from fiab_core.fable import BlockInstanceId, BlueprintTemplateExampleInput, ConfigurationOptionId, PluginCompositeId
from packaging.version import InvalidVersion, Version

from forecastbox.domain.auth.users import UserRead
from forecastbox.domain.glyphs.resolution import remap_glyph_names
from forecastbox.domain.plugin.compatibility import get_compatible_versions
from forecastbox.domain.plugin.db import PluginStateRecord, get_plugin_state, upsert_plugin_state
from forecastbox.domain.plugin.detail import PluginListing, build_plugin_listing
from forecastbox.domain.plugin.exceptions import PluginManagerBusy, PluginNotFound
from forecastbox.domain.plugin.state import PluginManager
from forecastbox.domain.plugin.store import get_plugins_detail, submit_install_single
from forecastbox.domain.plugin.submit import submit_uninstall_single, submit_unload_single, submit_update_single
from forecastbox.routes.admin import get_admin_user
from forecastbox.utility.concurrency.manager import execution_manager
from forecastbox.utility.config import PluginSettings, config
from forecastbox.utility.packages import get_package_versions
from forecastbox.utility.pydantic import FiabBaseModel

logger = logging.getLogger(__name__)

PREFIX = "/api/v1/plugin"

router = APIRouter(
    tags=["blueprint"],
    responses={404: {"description": "Not found"}},
)


# ---------------------------------------------------------------------------
# CRUD routes
# ---------------------------------------------------------------------------


@router.get("/list")
async def get_plugin_list() -> PluginListing:
    """Return a full listing of all known plugins with install, settings, and error detail."""
    try:
        return await build_plugin_listing()
    except PluginManagerBusy:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Plugin manager is busy; retry later")


# NOTE many routes are lazy in the sense they *submit* an operation (for eg pip install) and return with a success, before that
# operation is finished. We don't treat it as a clean 200, because it could actually fail later.
# Whether it succeeded would be ultimately derived from /list endpoint, but we don't want to return a redirect either, because
# that route would quite possibly fail right await due to submitted update being in progress.
# Ultimately, the caller is expected to subscribe to notifications, which will contain the success/failure + url to refresh
Accepted = Response(status_code=202)


@router.post("/update")
async def update_plugin(
    pluginCompositeId: PluginCompositeId,
    version: str | None = None,
    admin: UserRead | None = Depends(get_admin_user),
) -> Response:
    """Trigger a pip-install update for a plugin.

    If ``version`` is provided it must be a valid PEP 440 version string; the
    plugin will be pinned to exactly that version (``==version``).
    If omitted, the newest available version compatible with the installed
    ``fiab-core`` is selected.
    """
    target: Version | None = None
    if version is not None:
        try:
            target = Version(version)
        except InvalidVersion:
            raise HTTPException(status_code=422, detail=f"Invalid version string: {version!r}")
    else:
        settings_and_source = _pluginId2settingsAndSource(pluginCompositeId)
        if settings_and_source is None:
            raise HTTPException(status_code=404, detail=f"Plugin {pluginCompositeId!r} not found")
        plugin_settings, pip_source = settings_and_source
        versions = _settings2Versions(plugin_settings, pip_source)
        if not versions.versions:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"No compatible versions found for plugin {pluginCompositeId!r}",
            )
        target = Version(versions.versions[0])
    result = await submit_update_single(pluginCompositeId, install=True, version=target)
    if result:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=result)
    return Accepted


class PluginVersions(FiabBaseModel):
    versions: list[str]
    """Compatible versions, sorted newest first."""


def _pluginId2settingsAndSource(pluginCompositeId: PluginCompositeId) -> tuple[PluginSettings, str] | None:
    store_detail = get_plugins_detail()
    if pluginCompositeId in store_detail:
        store_entry, _ = store_detail[pluginCompositeId]
        pip_source = store_entry.pip_source
        return PluginSettings(pip_source=pip_source, module_name=store_entry.module_name), pip_source
    if pluginCompositeId in config.external.plugins:
        plugin_settings = config.external.plugins[pluginCompositeId]
        return plugin_settings, plugin_settings.pip_source
    return None


def _settings2Versions(pluginSettings: PluginSettings, pipSource: str) -> PluginVersions:
    available = get_package_versions(pipSource)
    compatible = get_compatible_versions(pluginSettings, available)
    sorted_versions = sorted(compatible, key=lambda v: Version(v), reverse=True)
    return PluginVersions(versions=sorted_versions)


@router.get("/versions")
def get_plugin_versions(pluginCompositeId: Annotated[PluginCompositeId, Depends()]) -> PluginVersions:
    """Return available PyPI versions of a plugin that are compatible with the installed ``fiab-core``.

    Compatibility is defined as equal major version. Only versions published
    on PyPI are considered; locally-installed or git-sourced plugins will
    receive an empty list.
    """
    settings_and_source = _pluginId2settingsAndSource(pluginCompositeId)
    if settings_and_source is None:
        raise HTTPException(status_code=404, detail=f"Plugin {pluginCompositeId!r} not found")
    return _settings2Versions(*settings_and_source)


@router.post("/install")
async def install_plugin(pluginCompositeId: PluginCompositeId, admin: UserRead | None = Depends(get_admin_user)) -> Response:
    # TODO possibly add optional version parameter
    await submit_install_single(pluginCompositeId)
    return Accepted


@router.post("/uninstall")
async def uninstall_plugin_endpoint(pluginCompositeId: PluginCompositeId, admin: UserRead | None = Depends(get_admin_user)) -> Response:
    await submit_uninstall_single(pluginCompositeId)
    return Accepted


class PluginSettingsUpdateRequest(FiabBaseModel):
    pluginCompositeId: PluginCompositeId
    isEnabled: bool | None = None
    """Enable or disable the plugin. ``None`` leaves the stored value unchanged."""
    excluded_templates: list[str] | None = None
    """Names of templates to exclude. ``None`` leaves the stored list unchanged;
    an empty list explicitly clears all exclusions."""
    glyph_remapping: dict[str, str] | None = None
    """Glyph rename map to persist. ``None`` leaves the stored map unchanged;
    an empty dict explicitly clears all remappings."""


@router.post("/settings")
async def update_plugin_settings_endpoint(
    body: PluginSettingsUpdateRequest,
    admin: UserRead | None = Depends(get_admin_user),
) -> Response:
    """Persist plugin settings (enabled flag, exclusions, remapping) and trigger a re-ingest."""
    plugin_id_str = PluginCompositeId.to_str(body.pluginCompositeId)
    try:
        await execution_manager.await_jobs_db(
            "plugin.state.upsert",
            partial(
                upsert_plugin_state,
                plugin_id=plugin_id_str,
                enabled=body.isEnabled,
                excluded_templates=body.excluded_templates,
                glyph_remapping=body.glyph_remapping,
            ),
        )
    except PluginNotFound:
        raise HTTPException(status_code=404, detail=f"Plugin {plugin_id_str} not found")
    if body.isEnabled is False:
        await submit_unload_single(body.pluginCompositeId)
        return Accepted
    result = await submit_update_single(body.pluginCompositeId, install=False, version=None)
    if result:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=result)
    return Accepted


class TemplateExampleValuesResponse(FiabBaseModel):
    example_values: dict[BlockInstanceId, dict[ConfigurationOptionId, BlueprintTemplateExampleInput]]
    """Per-block example configuration values, keyed by block instance id then option id."""
    example_glyphs: dict[str, BlueprintTemplateExampleInput]
    """Example glyph name-to-value pairs the user is expected to override."""


@router.get("/templateExampleValues")
async def get_template_example_values(
    pluginCompositeId: Annotated[PluginCompositeId, Depends()],
    displayName: str,
) -> TemplateExampleValuesResponse:
    """Return example_values and example_glyphs for a specific blueprint template from a loaded plugin.

    Applies any stored glyph remapping to both the values and keys of the example data,
    mirroring the remapping applied during template ingestion.

    Returns 404 if the plugin is not loaded or the display name is not found.
    Returns 403 if the template is excluded by admin settings.
    """
    plugin = PluginManager.plugins.get(pluginCompositeId)
    if plugin is None:
        raise HTTPException(status_code=404, detail=f"Plugin {PluginCompositeId.to_str(pluginCompositeId)!r} not loaded")

    template = next((t for t in plugin.blueprint_templates if t.display_name == displayName), None)
    if template is None:
        raise HTTPException(
            status_code=404, detail=f"Template {displayName!r} not found in plugin {PluginCompositeId.to_str(pluginCompositeId)!r}"
        )

    plugin_id_str = PluginCompositeId.to_str(pluginCompositeId)
    plugin_state = cast(
        PluginStateRecord | None,
        await execution_manager.await_jobs_db(
            "plugin.state.get",
            partial(get_plugin_state, plugin_id_str),
        ),
    )
    if plugin_state is None:
        raise HTTPException(status_code=404, detail=f"Plugin {PluginCompositeId.to_str(pluginCompositeId)!r} not installed")
    excluded_set = set(plugin_state.excluded_templates)
    if displayName in excluded_set:
        raise HTTPException(status_code=403, detail=f"Template {displayName!r} is excluded")

    glyph_remapping = dict(plugin_state.glyph_remapping)

    remapped_example_values: dict[BlockInstanceId, dict[ConfigurationOptionId, BlueprintTemplateExampleInput]] = {
        BlockInstanceId(block_id): {
            ConfigurationOptionId(opt_id): inp.model_copy(update={"example_value": remap_glyph_names(inp.example_value, glyph_remapping)})
            for opt_id, inp in opts.items()
        }
        for block_id, opts in template.example_values.items()
    }
    remapped_example_glyphs: dict[str, BlueprintTemplateExampleInput] = {
        glyph_remapping.get(key, key): inp.model_copy(update={"example_value": remap_glyph_names(inp.example_value, glyph_remapping)})
        for key, inp in template.example_glyphs.items()
    }

    return TemplateExampleValuesResponse(example_values=remapped_example_values, example_glyphs=remapped_example_glyphs)

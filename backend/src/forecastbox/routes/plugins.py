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

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from fiab_core.fable import PluginCompositeId
from packaging.version import InvalidVersion, Version

from forecastbox.domain.auth.users import UserRead
from forecastbox.domain.plugin.compatibility import get_compatible_versions
from forecastbox.domain.plugin.db import update_plugin_settings
from forecastbox.domain.plugin.manager import PluginsStatus, modify_enabled, status_full, submit_update_single, uninstall_plugin
from forecastbox.domain.plugin.store import PluginRemoteInfo, PluginStoreEntry, get_plugins_detail, submit_install_plugin
from forecastbox.routes.admin import get_admin_user
from forecastbox.utility.config import PluginSettings, config
from forecastbox.utility.packages import get_package_versions
from forecastbox.utility.pydantic import FiabBaseModel

PREFIX = "/api/v1/plugin"

router = APIRouter(
    tags=["blueprint"],
    responses={404: {"description": "Not found"}},
)


class PluginDetail(FiabBaseModel):
    status: Literal["available", "disabled", "errored", "loaded"]
    """Status of the plugin, mutually exclusive. All of (disabled, errored, loaded) imply that the plugin is installed"""
    store_info: PluginStoreEntry | None = None
    """Info about the plugin from the respective store. None if the plugin was installed locally"""
    remote_info: PluginRemoteInfo | None = None
    """Dynamic remote information such as the most recent published version. None if the plugin was installed locally"""
    errored_detail: str | None = None
    """In case the plugin is errored, (eg installed but failed to load), this displays detail"""
    loaded_version: str | None = None
    """In case the plugin is loaded, this shows the version"""
    update_datetime: str | None = None
    """In case the plugin is installed, this shows the most recent update datetime"""
    # TODO add here the remapping/exclusion data


class PluginListing(FiabBaseModel):
    plugins: dict[PluginCompositeId, PluginDetail]


# ---------------------------------------------------------------------------
# Operational routes
# ---------------------------------------------------------------------------


@router.get("/status")
async def get_plugins_status_full() -> PluginsStatus:
    return await status_full()


# ---------------------------------------------------------------------------
# CRUD routes
# ---------------------------------------------------------------------------


@router.get("/details")
async def get_plugin_details(forceRefresh: bool = False) -> PluginListing:
    # TODO implement forceRefresh -- we would need to prod the thread to update the store, but await its completion here
    if forceRefresh:
        raise NotImplementedError
    rv = {}
    statuses = await status_full()
    disabled = {plugin_id for plugin_id, enabled in statuses.plugin_enabled.items() if not enabled}
    errored = set(statuses.plugin_errors.keys())
    loaded = set(statuses.plugin_versions.keys())
    installed = errored.union(loaded).union(disabled)
    for pluginCompositeId, (storeEntry, remoteInfo) in get_plugins_detail().items():
        rv[pluginCompositeId] = PluginDetail(
            status="available",
            store_info=storeEntry,
            remote_info=remoteInfo,
        )
    for pluginCompositeId in installed:
        if pluginCompositeId in errored:
            status = "errored"
        elif pluginCompositeId in loaded:
            status = "loaded"
        elif pluginCompositeId in disabled:
            status = "disabled"
        else:
            status = "available"
        update = {
            "status": status,
            "errored_detail": statuses.plugin_errors.get(pluginCompositeId, None),  # ty:ignore[no-matching-overload]
            "loaded_version": statuses.plugin_versions.get(pluginCompositeId, None),  # ty:ignore[no-matching-overload]
            "update_datetime": statuses.plugin_updatedatetime.get(pluginCompositeId, None),  # ty:ignore[no-matching-overload]
        }
        if pluginCompositeId not in rv:
            rv[pluginCompositeId] = PluginDetail(**update)  # ty:ignore[invalid-argument-type]
        else:
            rv[pluginCompositeId] = rv[pluginCompositeId].model_copy(update=update)
    return PluginListing(plugins=rv)


# TODO ideally we'd return the redirect here, but that is basically guaranteed to end up with a 503 because
# the plugins aren't ready yet -- we probably need to await here or smth
# get_catalogue_redirect = lambda request: RedirectResponse(request.url_for("get_catalogue"), status_code=status.HTTP_303_SEE_OTHER)
get_catalogue_redirect = lambda request: Response(status_code=202)


@router.post("/update")
def update_plugin(
    request: Request,
    pluginCompositeId: PluginCompositeId,
    version: str | None = None,
    admin: UserRead | None = Depends(get_admin_user),
) -> Response:
    """Trigger a pip-install update for a plugin.

    If ``version`` is provided it must be a valid PEP 440 version string; the
    plugin will be pinned to exactly that version (``==version``).
    If omitted, a compatibility range derived from the current ``fiab-core``
    major version is used (``>=major,<major+1``), ensuring the installed plugin
    stays within the same major-version family as the core library.
    """
    if version is not None:
        try:
            parsed: Version | None = Version(version)
        except InvalidVersion:
            raise HTTPException(status_code=422, detail=f"Invalid version string: {version!r}")
    else:
        parsed = None
    result = submit_update_single(pluginCompositeId, install=True, version=parsed)
    if result:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=result)
    return get_catalogue_redirect(request)


class PluginVersions(FiabBaseModel):
    versions: list[str]
    """Compatible versions, sorted newest first."""


@router.get("/versions")
def get_plugin_versions(pluginCompositeId: Annotated[PluginCompositeId, Depends()]) -> PluginVersions:
    """Return available PyPI versions of a plugin that are compatible with the installed ``fiab-core``.

    Compatibility is defined as equal major version.  Only versions published
    on PyPI are considered; locally-installed or git-sourced plugins will
    receive an empty list.
    """
    pip_source: str | None = None

    store_detail = get_plugins_detail()
    if pluginCompositeId in store_detail:
        store_entry, _ = store_detail[pluginCompositeId]
        pip_source = store_entry.pip_source
        plugin_settings = PluginSettings(pip_source=pip_source, module_name=store_entry.module_name)
    elif pluginCompositeId in config.external.plugins:
        plugin_settings = config.external.plugins[pluginCompositeId]
        pip_source = plugin_settings.pip_source
    else:
        raise HTTPException(status_code=404, detail=f"Plugin {pluginCompositeId!r} not found")

    available = get_package_versions(pip_source)
    compatible = get_compatible_versions(plugin_settings, available)
    sorted_versions = sorted(compatible, key=lambda v: Version(v), reverse=True)
    return PluginVersions(versions=sorted_versions)


@router.post("/install")
def install_plugin(request: Request, pluginCompositeId: PluginCompositeId, admin: UserRead | None = Depends(get_admin_user)) -> Response:
    # TODO possibly add optional version parameter
    submit_install_plugin(pluginCompositeId)
    return get_catalogue_redirect(request)


@router.post("/uninstall")
def uninstall_plugin_endpoint(
    request: Request, pluginCompositeId: PluginCompositeId, admin: UserRead | None = Depends(get_admin_user)
) -> Response:
    uninstall_plugin(pluginCompositeId)
    return get_catalogue_redirect(request)


@router.post("/modifyEnabled")
def modify_enabled_endpoint(
    request: Request, pluginCompositeId: PluginCompositeId, isEnabled: bool, admin: UserRead | None = Depends(get_admin_user)
) -> Response:
    modify_enabled(pluginCompositeId, isEnabled)
    return get_catalogue_redirect(request)


class PluginSettingsUpdateRequest(FiabBaseModel):
    pluginCompositeId: PluginCompositeId
    excluded_templates: list[str] | None = None
    """Names of templates to exclude.  ``None`` leaves the stored list unchanged;
    an empty list explicitly clears all exclusions."""
    glyph_remapping: dict[str, str] | None = None
    """Glyph rename map to persist.  ``None`` leaves the stored map unchanged;
    an empty dict explicitly clears all remappings."""


@router.post("/settings")
async def update_plugin_settings_endpoint(
    request: Request,
    body: PluginSettingsUpdateRequest,
    admin: UserRead | None = Depends(get_admin_user),
) -> Response:
    """Persist plugin install settings and trigger a re-ingest so exclusions take effect immediately."""
    await update_plugin_settings(
        plugin_id=PluginCompositeId.to_str(body.pluginCompositeId),
        excluded_templates=body.excluded_templates,
        glyph_remapping=body.glyph_remapping,
    )
    result = submit_update_single(body.pluginCompositeId, install=False, version=None)
    if result:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=result)
    return get_catalogue_redirect(request)

# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""User-facing API for plugins, that is, standalone python modules providing
definitions of fable blocks like products or sources.

In particular
 - retrieve status information about plugins
 - invoke manual plugin update
"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel

from forecastbox.api.plugin.manager import PluginsStatus, modify_enabled, status_full, submit_update_single, uninstall_plugin
from forecastbox.api.plugin.store import PluginRemoteInfo, PluginStoreEntry, get_plugins_detail, submit_install_plugin
from forecastbox.api.routers.admin import get_admin_user
from forecastbox.api.types.fable import PluginCompositeId
from forecastbox.config import config

router = APIRouter(
    tags=["fable"],
    responses={404: {"description": "Not found"}},
)


@router.get("/status")
def get_plugins_status_full() -> PluginsStatus:
    return status_full()


class PluginDetail(BaseModel):
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
    update_date: str | None = None
    """In case the plugin is installed, this shows the most recent update date"""


class PluginListing(BaseModel):
    plugins: dict[PluginCompositeId, PluginDetail]


@router.get("/details")
def get_plugin_details(forceRefresh: bool = False) -> PluginListing:
    # TODO implement forceRefresh -- we would need to prod the thread to update the store, but await its completion here
    if forceRefresh:
        raise NotImplementedError
    rv = {}
    statuses = status_full()
    disabled = {pluginCompositeId for pluginCompositeId, pluginSettings in config.product.plugins.items() if not pluginSettings.enabled}
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
            "update_date": statuses.plugin_updatedate.get(pluginCompositeId, None),  # ty:ignore[no-matching-overload]
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
def update_plugin(request: Request, pluginCompositeId: PluginCompositeId, admin=Depends(get_admin_user)) -> Response:
    # TODO possibly add optional version parameter
    result = submit_update_single(pluginCompositeId, isUpdate=True)
    if result:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=result)
    return get_catalogue_redirect(request)


@router.post("/install")
def install_plugin(request: Request, pluginCompositeId: PluginCompositeId, admin=Depends(get_admin_user)) -> Response:
    # TODO possibly add optional version parameter
    submit_install_plugin(pluginCompositeId)
    return get_catalogue_redirect(request)


@router.post("/uninstall")
def uninstall_plugin_endpoint(request: Request, pluginCompositeId: PluginCompositeId, admin=Depends(get_admin_user)) -> Response:
    uninstall_plugin(pluginCompositeId)
    return get_catalogue_redirect(request)


@router.post("/modifyEnabled")
def modify_enabled_endpoint(
    request: Request, pluginCompositeId: PluginCompositeId, isEnabled: bool, admin=Depends(get_admin_user)
) -> Response:
    modify_enabled(pluginCompositeId, isEnabled)
    return get_catalogue_redirect(request)

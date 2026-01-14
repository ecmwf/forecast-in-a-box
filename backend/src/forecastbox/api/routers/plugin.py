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

from fastapi import APIRouter, Depends, HTTPException, status

from forecastbox.api.plugin.manager import PluginsStatus, modify_enabled, status_full, submit_update_single, uninstall_plugin
from forecastbox.api.plugin.store import submit_install_plugin
from forecastbox.api.routers.admin import get_admin_user
from forecastbox.api.types.fable import PluginCompositeId

router = APIRouter(
    tags=["fable"],
    responses={404: {"description": "Not found"}},
)


@router.get("/status")
def get_plugins_status_full() -> PluginsStatus:
    return status_full()

    # TODO
    """
    get plugins
        we need plugin dynamic metadata class
        we need plugin dynamic metadata filling from pypi
        we need plugin dynamic metadata filling from local + join with the plugin manager
        then reroute the plugin status from manager to here (perhaps keep that one as updater status)
        and implement forceRefresh... -- sorta managed thread like in manager
     """


@router.post("/update")
def update_plugin(pluginCompositeId: PluginCompositeId, admin=Depends(get_admin_user)) -> None:
    # TODO add optional version parameter
    result = submit_update_single(pluginCompositeId, isLoad=False, isUpdate=True)
    if result:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=result)


@router.post("/install")
def install_plugin(pluginCompositeId: PluginCompositeId, admin=Depends(get_admin_user)) -> None:
    # TODO add optional version parameter
    submit_install_plugin(pluginCompositeId)


@router.post("/uninstall")
def uninstall_plugin(pluginCompositeId: PluginCompositeId, admin=Depends(get_admin_user)) -> None:
    uninstall_plugin(pluginCompositeId)


@router.post("/modifyEnabled")
def modify_enabled(pluginCompositeId: PluginCompositeId, isEnabled: bool, admin=Depends(get_admin_user)) -> None:
    modify_enabled(pluginCompositeId, isEnabled)

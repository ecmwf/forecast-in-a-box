# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Status and view helpers for the routes"""

from fiab_core.fable import BlockFactoryCatalogue, PluginCompositeId

from forecastbox.domain.plugin.state import PluginManager
from forecastbox.utility.concurrency.synchronization import timed_acquire


def status_brief() -> str:
    if PluginManager.updater_error is not None:
        return f"failure: {PluginManager.updater_error}"
    elif PluginManager.operation_in_progress:
        return "running"
    else:
        return "ok"


def plugins_ready() -> bool:
    return status_brief() == "ok"


def catalogue_view() -> dict[PluginCompositeId, BlockFactoryCatalogue] | bool:
    with timed_acquire(PluginManager.lock, 1.0) as result:
        if not result:
            return False
        else:
            plugins = PluginManager.plugins
    return {plugin_id: plugin.catalogue for plugin_id, plugin in PluginManager.plugins.items()}

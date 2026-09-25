# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""The pip-install/import spec of a single plugin.

Not part of the static configuration -- once a plugin is installed, this information is
persisted in the plugin_state database table (see ``domain.plugin.db``) and read back from
there on every subsequent operation (reload at startup, update, settings toggle, uninstall).
It is only ever sourced fresh from a plugin store at install time, see
``domain.plugin.store.resolve_plugin_from_store``.
"""

from typing import Literal

from forecastbox.utility.pydantic import FiabBaseModel

PluginRefreshStrategy = Literal["automatic", "manual"]


class PluginSettings(FiabBaseModel):
    """A pip-installable plugin with an importible module"""

    pip_source: str
    """Name of the package if assuming PyPI, or a local path, git repo, ... Anything that pip accepts"""
    module_name: str
    """A string such that `importlib.import_module(module_name)` gives a module that has a `plugin` attribute of type fiab_core.plugin.Plugin`"""
    update_strategy: PluginRefreshStrategy = "manual"
    """Whether we should invoke `pip install --update <plugin>` on every launch, or let user handle that manually or via API"""

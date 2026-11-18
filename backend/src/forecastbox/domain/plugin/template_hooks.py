# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Process-local slot for the blueprint template ingestion/removal hooks.

The plugin domain must not depend on the blueprint domain, yet publishing or unloading a plugin
requires its blueprint templates to be ingested or removed. The entrypoint therefore registers the
blueprint domain's functions here during initialization (see
``forecastbox.entrypoint.initializers.register_providers``), and the plugin loading code calls them
synchronously on its own thread.
"""

from collections.abc import Callable
from dataclasses import dataclass

from fiab_core.fable import PluginCompositeId

from forecastbox.domain.plugin.exceptions import PluginTemplateHooksNotRegistered


@dataclass(frozen=True, eq=True, slots=True)
class TemplateHooks:
    on_changed: Callable[[PluginCompositeId], None]
    """Ingests the blueprint templates of a published plugin. Called after the plugin was published."""
    on_removed: Callable[[PluginCompositeId], None]
    """Removes the blueprint templates of a plugin, idempotently. Called before the plugin is unpublished."""


class _TemplateHooksSlot:
    hooks: TemplateHooks | None = None


def register_template_hooks(hooks: TemplateHooks) -> None:
    _TemplateHooksSlot.hooks = hooks


def get_template_hooks() -> TemplateHooks:
    """Return the registered hooks. Raises PluginTemplateHooksNotRegistered if none were registered."""
    hooks = _TemplateHooksSlot.hooks
    if hooks is None:
        raise PluginTemplateHooksNotRegistered(
            "plugin template hooks are not registered -- forecastbox.entrypoint.initializers.register_providers must run first"
        )
    return hooks

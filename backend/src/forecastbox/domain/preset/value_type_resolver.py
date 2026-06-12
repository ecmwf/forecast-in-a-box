# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Dynamic value_type resolution for preset parameters.

Preset parameters may declare a ``value_type`` of the form::

    ref://catalogue/<store>/<local>/<factory>/<option>

When the preset ``/get`` endpoint serves a parameter with such a value_type,
this module resolves it to the concrete ``enumClosed[...]`` (or other) string
that the named block-factory option currently exposes in the live catalogue.

This allows model/forecast parameters to stay in sync with whatever datasets
and checkpoints are actually installed, without requiring a DB migration every
time a new model is added or removed.

Syntax
------
The URI form is::

    ref://catalogue/<store>/<local>/<factory>/<option>

For example::

    ref://catalogue/ecmwf/ecmwf-base/operationalForecastSource/forecast

resolves to whatever ``value_type`` the ``forecast`` configuration option of
the ``operationalForecastSource`` factory in the ``ecmwf/ecmwf-base`` plugin
currently reports (e.g. ``enumClosed[aifs-ens,ifs-ens]``).

Fallback behaviour
------------------
If the catalogue is not yet ready, the plugin/factory/option path is not
found, or any other error occurs, the original ``ref://catalogue/...`` string
is returned unchanged so the frontend can render a plain text input as a
graceful degradation.

If the catalogue is still being populated when ``/get`` is called, resolution
waits on the plugin updater thread (via ``wait_until_ready``) for up to
``_PLUGINS_READY_TIMEOUT_S`` seconds before falling back to the raw reference.
"""

from __future__ import annotations

import asyncio
import logging
import re

from fiab_core.fable import PluginCompositeId, PluginId, PluginStoreId

from forecastbox.domain.plugin.manager import catalogue_view, wait_until_ready

logger = logging.getLogger(__name__)

# Pattern: ref://catalogue/<store>/<local>/<factory>/<option>
_CATALOGUE_REF_RE = re.compile(
    r"^ref://catalogue/([^/]+)/([^/]+)/([^/]+)/(.+)$",
    re.IGNORECASE,
)

_PLUGINS_READY_TIMEOUT_S: float = 30.0


def resolve_value_type(value_type: str) -> str:
    """Resolve a ``value_type`` string, expanding any ``ref://catalogue/...`` reference.

    If ``value_type`` does not match the ``ref://catalogue/...`` pattern it is
    returned unchanged.  Resolution failures are logged and the original string
    is returned so callers always receive a valid (if unresolved) value.

    When the plugin updater thread is still running this function waits up to
    ``_PLUGINS_READY_TIMEOUT_S`` seconds for it to finish before falling back
    to the raw reference string.

    .. warning::
       **BLOCKING OPERATION**: This function may block for up to 30 seconds
       waiting for plugins to initialize via ``wait_until_ready()``.

       **DO NOT** call this function directly from async code as it will block
       the event loop.

       When calling from async contexts, use::

           await async_resolve_value_type(value_type)

       or explicitly wrap in a thread::

           await asyncio.to_thread(resolve_value_type, value_type)

    Args:
        value_type: The raw ``value_type`` string from a ``PresetParameter``.

    Returns:
        The resolved value_type string (e.g. ``enumClosed[aifs-,...]``),
        or the original string if resolution is not applicable or fails.
    """
    match = _CATALOGUE_REF_RE.match(value_type.strip())
    if match is None:
        return value_type

    store, local, factory, option = match.groups()
    plugin_display_key = f"{store}/{local}"

    try:
        if not wait_until_ready(_PLUGINS_READY_TIMEOUT_S):
            logger.warning(
                "Catalogue not ready; returning raw value_type %r for %s/%s/%s",
                value_type,
                plugin_display_key,
                factory,
                option,
            )
            return value_type

        catalogue = catalogue_view()
        if isinstance(catalogue, bool):
            logger.warning(
                "catalogue_view() returned bool (lock timeout); returning raw value_type %r",
                value_type,
            )
            return value_type

        # catalogue keys are PluginCompositeId objects; normalise to display format.
        target_plugin_id = PluginCompositeId(
            store=PluginStoreId(store),  # type: ignore[arg-type]
            local=PluginId(local),  # type: ignore[arg-type]
        )

        plugin_catalogue = catalogue.get(target_plugin_id)
        if plugin_catalogue is None:
            logger.warning(
                "Plugin %r not found in catalogue (available: %s); returning raw value_type %r",
                plugin_display_key,
                [f"{pid.store}/{pid.local}" for pid in catalogue.keys()],
                value_type,
            )
            return value_type

        factory_catalogue = plugin_catalogue.factories.get(factory)  # type: ignore[attr-defined]
        if factory_catalogue is None:
            logger.warning(
                "Factory %r not found in plugin %r (available: %s); returning raw value_type %r",
                factory,
                plugin_display_key,
                list(plugin_catalogue.factories.keys()),  # type: ignore[attr-defined]
                value_type,
            )
            return value_type

        option_detail = factory_catalogue.configuration_options.get(option)  # type: ignore[attr-defined]
        if option_detail is None:
            logger.warning(
                "Option %r not found in factory %r/%r (available: %s); returning raw value_type %r",
                option,
                plugin_display_key,
                factory,
                list(factory_catalogue.configuration_options.keys()),  # type: ignore[attr-defined]
                value_type,
            )
            return value_type

        resolved: str = str(option_detail.value_type)
        logger.info(
            "Resolved ref://catalogue/%s/%s/%s → %r",
            plugin_display_key,
            factory,
            option,
            resolved,
        )
        return resolved

    except Exception:
        logger.exception(
            "Unexpected error resolving value_type %r; returning raw string",
            value_type,
        )
        return value_type


async def async_resolve_value_type(value_type: str) -> str:
    """Async wrapper for ``resolve_value_type`` that safely runs it in a thread pool.

    This function is the recommended way to call ``resolve_value_type`` from async
    code, as it prevents blocking the event loop during the potentially long wait
    for plugin initialization.

    Args:
        value_type: The raw ``value_type`` string from a ``PresetParameter``.

    Returns:
        The resolved value_type string (e.g. ``enumClosed[aifs-,...]``),
        or the original string if resolution is not applicable or fails.

    See Also:
        :func:`resolve_value_type` for details on the resolution logic.
    """
    return await asyncio.to_thread(resolve_value_type, value_type)

# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import dataclasses

from fiab_core.fable import BlockFactoryId
from fiab_core.plugin import Plugin
from fiab_core.tools.blocks import QubedBlockBuilder
from fiab_core.tools.plugins import QubedPluginBuilder

from fiab_plugin_ecmwf.anemoi.blocks import AnemoiInputSource, AnemoiSource, AnemoiTransform
from fiab_plugin_ecmwf.blocks import (
    EnsembleStatistics,
    GribSink,
    MapPlotSink,
    OperationalForecastSource,
    Select,
    TemporalStatistics,
    ZarrSink,
)
from fiab_plugin_ecmwf.templates.prototype import template as _prototype_template

blocks: dict[BlockFactoryId, QubedBlockBuilder] = {
    BlockFactoryId("operationalForecastSource"): OperationalForecastSource(),
    BlockFactoryId("ensembleStatistics"): EnsembleStatistics(),
    BlockFactoryId("temporalStatistics"): TemporalStatistics(),
    BlockFactoryId("select"): Select(),
    BlockFactoryId("zarrSink"): ZarrSink(),
    BlockFactoryId("gribSink"): GribSink(),
    BlockFactoryId("anemoiSource"): AnemoiSource(),
    BlockFactoryId("anemoiInputSource"): AnemoiInputSource(),
    BlockFactoryId("anemoiTransform"): AnemoiTransform(),
    BlockFactoryId("mapPlotSink"): MapPlotSink(),
}

_base_plugin = QubedPluginBuilder(block_builders=blocks, base_environment=["fiab-plugin-ecmwf"]).as_plugin()


def plugin() -> Plugin:
    return dataclasses.replace(_base_plugin(), blueprint_templates=(_prototype_template,))

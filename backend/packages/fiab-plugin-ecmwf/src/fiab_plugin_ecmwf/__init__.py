# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from fiab_core.fable import BlockFactoryId
from fiab_core.tools.blocks import QubedBlockBuilder
from fiab_core.tools.plugins import QubedPluginBuilder

from fiab_plugin_ecmwf.anemoi.blocks import AnemoiSource, AnemoiTransform
from fiab_plugin_ecmwf.blocks import (
    EkdSource,
    EnsembleStatistics,
    MapPlotSink,
    SelectMembers,
    SelectParameters,
    SelectSteps,
    TemporalStatistics,
    ZarrSink,
)

blocks: dict[BlockFactoryId, QubedBlockBuilder] = {
    BlockFactoryId("ekdSource"): EkdSource(),
    BlockFactoryId("ensembleStatistics"): EnsembleStatistics(),
    BlockFactoryId("temporalStatistics"): TemporalStatistics(),
    BlockFactoryId("selectParameters"): SelectParameters(),
    BlockFactoryId("selectSteps"): SelectSteps(),
    BlockFactoryId("selectMembers"): SelectMembers(),
    BlockFactoryId("zarrSink"): ZarrSink(),
    BlockFactoryId("anemoiSource"): AnemoiSource(),
    BlockFactoryId("anemoiTransform"): AnemoiTransform(),
    BlockFactoryId("mapPlotSink"): MapPlotSink(),
}

plugin = QubedPluginBuilder(block_builders=blocks, base_environment=["fiab-plugin-ecmwf"]).as_plugin()

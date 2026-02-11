# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Fundamental APIs of Forecast As BLock Expression (Fable)
"""

import logging
from collections import defaultdict
from itertools import groupby
from typing import Iterator, cast

from cascade.low.into import graph2job
from earthkit.workflows import visualise
from earthkit.workflows.graph import Graph, deduplicate_nodes
from fiab_core.fable import (
    BlockConfigurationOption,
    BlockFactory,
    BlockFactoryCatalogue,
    BlockFactoryId,
    BlockInstanceId,
    BlockKind,
    PluginBlockFactoryId,
)

from forecastbox.api.plugin.manager import PluginManager
from forecastbox.api.types import RawCascadeJob
from forecastbox.api.types.fable import (
    FableBuilderV1,
    FableValidationExpansion,
)

logger = logging.getLogger(__name__)


def topological_order(fable: FableBuilderV1) -> Iterator[BlockInstanceId]:
    remaining = {}
    children = defaultdict(list)
    queue = []
    for blockId, blockInstance in fable.blocks.items():
        l = len(blockInstance.input_ids)
        if l == 0:
            queue.append(blockId)
        else:
            remaining[blockId] = l
        for parent in blockInstance.input_ids.values():
            children[parent].append(blockId)
    while queue:
        head = queue.pop(0)
        yield head
        for child in children[head]:
            remaining[child] -= 1
            if remaining[child] == 0:
                queue.append(child)


def validate_expand(fable: FableBuilderV1) -> FableValidationExpansion:
    # TODO this will be repeatedly called -- we probably need to cache a lot here

    plugins = PluginManager.plugins  # TODO we are avoiding a lock here! See the TODO at api/plugin.py
    possible_sources = [
        PluginBlockFactoryId(plugin=plugin_id, factory=block_factory_id)
        for plugin_id, plugin in plugins.items()
        for block_factory_id, block_factory in plugin.catalogue.factories.items()
        if block_factory.kind == "source" and not block_factory.inputs
    ]
    possible_expansions = {}
    block_errors = defaultdict(list)
    outputs = {}
    for blockId in topological_order(fable):
        blockInstance = fable.blocks[blockId]
        # validate basic consistency
        plugin = plugins.get(blockInstance.factory_id.plugin, None)
        if not plugin:
            block_errors[blockId] += ["Plugin not found"]
            continue
        blockFactory = plugin.catalogue.factories.get(blockInstance.factory_id.factory, None)
        if not blockFactory:
            block_errors[blockId] += ["BlockFactory not found in the catalogue"]
            continue
        extraConfig = blockInstance.configuration_values.keys() - blockFactory.configuration_options.keys()
        if extraConfig:
            block_errors[blockId] += [f"Block contains extra config: {extraConfig}"]
        missingConfig = blockFactory.configuration_options.keys() - blockInstance.configuration_values.keys()
        if missingConfig:
            # TODO most likely disable this, we would inject defaults at the compile level
            block_errors[blockId] += [f"Block contains missing config: {missingConfig}"]

        # validate config values can be deserialized
        # TODO -- some general purp deser

        inputs = {input_id: outputs[source_id] for input_id, source_id in blockInstance.input_ids.items()}
        output_or_error = plugin.validator(blockInstance, inputs)
        if output_or_error.t is None:
            block_errors[blockId] += cast(str, output_or_error.e)
            continue
        outputs[blockId] = output_or_error.t

        possible_expansions[blockId] = [
            PluginBlockFactoryId(plugin=any_plugin_id, factory=block_factory_id)
            for any_plugin_id, any_plugin in plugins.items()
            for block_factory_id in any_plugin.expander(output_or_error.t)
        ]

    global_errors = []  # cant think of any rn

    return FableValidationExpansion(
        possible_sources=possible_sources,
        possible_expansions=possible_expansions,
        block_errors=block_errors,
        global_errors=global_errors,
    )


def compile(fable: FableBuilderV1) -> RawCascadeJob:
    graph = Graph([])
    plugins = PluginManager.plugins  # TODO we are avoiding a lock here! See the TODO at api/plugin.py
    data_partition_lookup = {}

    for blockId in topological_order(fable):
        blockInstance = fable.blocks[blockId]
        plugin = plugins.get(blockInstance.factory_id.plugin, None)
        if not plugin:
            raise ValueError(f"plugin for {blockId=} not found")
        result = plugin.compiler(data_partition_lookup, blockId, blockInstance)
        if result.t is None:
            raise ValueError(f"compile failed at {blockId=} with {result.e}")
        data_partition_lookup = result.t
        block_factory = plugin.catalogue.factories[blockInstance.factory_id.factory]
        if block_factory.kind == "sink":
            graph += data_partition_lookup[blockId].graph()

    graph = deduplicate_nodes(graph)
    visualise(graph, "fable_compile_graph.html")
    result = graph2job(graph)
    return RawCascadeJob(job_type="raw_cascade_job", job_instance=result)


"""
TODO move this elsewhere
Further *frontend* extension requirements
    - localization support -- presumably the /catalogue endpoint will allow lang parameter and lookup translation strings
    - rich typing on the BlockConfigurationOptions, in particular we want:
      enum-fixed[1, 2, 3] -- so that frontend can show like radio
      enum-dynam[aifs1.0, aifs1.1, bris1.0] -- so that frontend can show like dropdown
      constant[42] -- just display non-editable field
    - configuration option prefills
      we want to set hard restrictions on admin level, like "always use 8 ensemble members for aifs1.0 model"
      we want to set overriddable defaults on any level, like "start with location: malawi for any model"
      => this would require endpoint "storeBlockConfig", keyed by blockId and optionally any number of option keyvalues, and soft/hard bool
      => if keyed only by blockId, we can make do with existing interface; for the multikeyed we need to extend the BlockConfigurationOption
    - dynamic configuration restrictions: imagine a Product allows for variables v1 v2 v3, and is being connected to a BlockInstanceOutput
      which provides v1 v2. Then we obviously want to offer to the user only v1 v2. This needs to be handled by extending the `extend`
      method in the plugins

Further *backend* discussion questions
    - do we compile to fluent at every /expand's validate, or do we validate at a higher level only during these steps, with
      fluent validation happening only during /compile? Advantage of frequent compilation is eg less code duplication, disadvantage
      is more pressure on compilation speed and a challenge to lift fluent errors to ui errors
    - does the compile endpoint return RawCascadeJob, ie, after fluent2cascade compilation, or do we instead return some fluent object?
      The latter has the advantage of being smaller, and subsequent higher level operations on it will be easier

Further *plugin* discussion questions
    - vocabulary/rich objects for BlockInstanceOutput: we want to drop the current "xarray" object, and replace with a union of
      some image concept and a proper earthkit-dataset representation, including qubed as well as unified vocabulary for variables,
      possibly also gridspec
    - parity between the plugin catalogues and runtimes -- a plugin catalogue operates with signatures of functions from runtime,
      when declaring configuration options, compiling task graphs, etc. How do we ensure that this signature matches the actual
      signature? Roughly three options: 1/ hope 2/ automated parity testing 3/ actually generate parts of the catalogue with eg tracing

Further automation questions:
    - CD for plugins -- do we want the same release triggers/pace? Or finegrain tags?
    - integration test for plugins (there is a helper file already but its rather raw)
    - existing plugins lookup as a static file + UI/UX for plugin installation
"""

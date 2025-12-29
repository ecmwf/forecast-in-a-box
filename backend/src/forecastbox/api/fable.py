from collections import defaultdict
from itertools import groupby
from typing import Iterator, cast

from cascade.low.builders import JobBuilder
from cascade.low.core import JobInstance
from fiab_core.fable import (
    BlockConfigurationOption,
    BlockFactory,
    BlockFactoryCatalogue,
    BlockFactoryId,
    BlockInstanceId,
    BlockKind,
    PluginBlockFactoryId,
)

from forecastbox.api.plugin import PluginManager
from forecastbox.api.types import RawCascadeJob
from forecastbox.api.types.fable import (
    FableBuilderV1,
    FableValidationExpansion,
)

"""
Fundamental APIs of Forecast As BLock Expression (Fable)
"""


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
        for parent in blockInstance.input_ids:
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
            block_errors[blockId] += ["Block contains extra config: {extraConfig}"]
        missingConfig = blockFactory.configuration_options.keys() - blockInstance.configuration_values.keys()
        if missingConfig:
            # TODO most likely disable this, we would inject defaults at the compile level
            block_errors[blockId] += ["Block contains missing config: {missingConfig}"]

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
    builder = JobBuilder()
    plugins = PluginManager.plugins  # TODO we are avoiding a lock here! See the TODO at api/plugin.py
    data_partition_lookup = {}

    for blockId in topological_order(fable):
        blockInstance = fable.blocks[blockId]
        plugin = plugins.get(blockInstance.factory_id.plugin, None)
        if not plugin:
            raise ValueError(f"plugin for {blockId=} not found")
        result = plugin.compiler(builder, data_partition_lookup, blockId, blockInstance)
        if result.t is None:
            raise ValueError(f"compile failed at {blockId=} with {result.e}")
        builder, data_partition_lookup = result.t

    result = builder.build()
    if result.t is None:
        error = ";".join(cast(list[str], result.e))
        raise ValueError(f"final compilation failed with {error}")

    # TODO instead something very much like api.execution.forecast_products_to_cascade
    return RawCascadeJob(job_type="raw_cascade_job", job_instance=result.t)


"""
Further *frontend* extension requirements (only as a comment to keep the first PR reasonably sized)
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
    - fable builder persistence -- we want a new endpoint that allows storing fable builder instances, for like favorites, quickstarts, work interrupts, etc
      we dont want to force the user to go through the from-scratch building every time -- there will be multiple stories/endpoints on top of
      the persist/load, providing a simplified path, though possibly with the option to "fully customize" that would expose the builder+/expand

Further *backend* discussion questions
    - do we treat the compilation as "source-product-sink" single line and then deduplicate, or do we instead compile the dag at once?
      the dag approach has better support for multi-input products, the deduplicate is more in line with the current codebase
    - do we compile to fluent at every /expand's validate, or do we validate at a higher level only during these steps, with
      fluent validation happening only during /compile? Advantage of frequent compilation is eg less code duplication, disadvantage
      is more pressure on compilation speed and a challenge to lift fluent errors to ui errors
    - what protocol would a "catalogue entry" be required, and how do we capture it? It has 4 concerns, BlockFactory, BlockInstance
      validation, BlockInstance expansion, and compiling into fluent
"""

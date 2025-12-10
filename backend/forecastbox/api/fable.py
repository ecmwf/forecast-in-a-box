from collections import defaultdict
from itertools import groupby

from cascade.low.core import JobInstance

from forecastbox.api.types import RawCascadeJob
from forecastbox.api.types.fable import (
    BlockConfigurationOption,
    BlockFactory,
    BlockFactoryCatalogue,
    BlockFactoryId,
    BlockKind,
    FableBuilder,
    FableValidationExpansion,
)

"""
Fundamental APIs of Forecast As BLock Expression (Fable)
"""

# NOTE this will not be hardcoded like this, but partially hardcoded in submodules and extended by plugins
catalogue = BlockFactoryCatalogue(
    factories={
        "model_forecast": BlockFactory(
            kind="source",
            title="Compute Model Forecast",
            description="Download initial conditions, run model forecast",
            configuration_options={
                "model": BlockConfigurationOption(title="Model Name", description="Locally available checkpoint to run", value_type="str"),
                "date": BlockConfigurationOption(
                    title="Initial Conditions DateTime", description="DateTime of the initial conditions", value_type="datetime"
                ),
                "lead_time": BlockConfigurationOption(title="Lead Time", description="Lead Time of the forecast", value_type="int"),
                "ensemble_members": BlockConfigurationOption(
                    title="Ensemble Members", description="How many ensemble member to use", value_type="int"
                ),
            },
            inputs=[],
        ),
        "mars_aifs_external": BlockFactory(
            kind="source",
            title="Download AIFS Forecast",
            description="Download an existing published AIFS forecast from MARS",
            configuration_options={
                "date": BlockConfigurationOption(
                    title="Initial Conditions DateTime", description="DateTime of the initial conditions", value_type="datetime"
                ),
                "lead_time": BlockConfigurationOption(title="Lead Time", description="Lead Time of the forecast", value_type="int"),
            },
            inputs=[],
        ),
        "product_123": BlockFactory(
            kind="product",
            title="Thingily-Dingily Index",
            description="Calculate the Thingily-Dingily index",
            configuration_options={
                "variables": BlockConfigurationOption(
                    title="Variables", description="Which variables (st, precip, cc, ...) to compute the index for", value_type="list[str]"
                ),
                "thingily-dingily-coefficient": BlockConfigurationOption(
                    title="Thingily-Dingily Coefficient", description="Coefficient of the Thingily-Dingiliness", value_type="float"
                ),
            },
            inputs=["forecast"],
        ),
        "product_456": BlockFactory(
            kind="product",
            title="Comparity-Romparity Ratio",
            description="Estimate the Comparity-Romparity ratio between two forecasts",
            configuration_options={},
            inputs=[
                "forecast1",
                "forecast2",
            ],  # NOTE this opens up an interesting question -- how to "tab-completion" with two inputs? My suggestion is to include this product as a possible completion to every source (as if it were a single-sourced product), but when the user clicks on it, the frontend recognizes "oh there are two inputs", and would give the user dialog with forecast1=the-block-user-clicked-on prefilled, and forecast2=(selection UI with every other block in the fable that had this product in its extension options). This will not work correctly if we have heterogeneous multiple inputs -- do we expect that? Like "compare model forecast to ground truth?"
        ),
        "store_local_fdb": BlockFactory(
            kind="sink",
            title="Local FDB persistence",
            description="Store any grib data to local fdb",
            configuration_options={
                "fdb_key_prefix": BlockConfigurationOption(title="FDB prefix", description="Like /experiments/run123", value_type="str"),
            },
            inputs=["data"],
        ),
        "plot": BlockFactory(
            kind="sink",
            description="Visualize",
            title="Visualize the result as a plot",
            configuration_options={
                "ekp_subcommand": BlockConfigurationOption(
                    title="Earthkit-Plots Subcommond", description="Full subcommand as understood by earthkit-plots", value_type="str"
                ),
            },
            inputs=["data"],
        ),
    }
)

blocksOfKind: dict[BlockKind, list[BlockFactoryId]] = {
    kind: [afk for (afk, _) in it] for kind, it in groupby(catalogue.factories.items(), lambda afkv: afkv[1].kind)
}


def validate_expand(fable: FableBuilder) -> FableValidationExpansion:
    possible_sources = blocksOfKind["source"]
    possible_expansions = {}
    block_errors = defaultdict(list)
    for blockId, blockInstance in fable.blocks.items():
        # validate basic consistency
        if blockId not in catalogue:
            block_errors[blockId] += ["BlockFactory not found in the catalogue"]
            continue
        blockFactory = catalogue.factories[blockId]
        # NOTE ty does not support walrus correctly yet
        extraConfig = blockInstance.configuration_values.keys() - blockFactory.configuration_options.keys()
        if extraConfig:
            block_errors[blockId] += ["Block contains extra config: {extraConfig}"]
        missingConfig = blockFactory.configuration_options.keys() - blockInstance.configuration_values.keys()
        if missingConfig:
            # TODO most likely disable this, we would inject defaults at the compile level
            block_errors[blockId] += ["Block contains missing config: {missingConfig}"]

        # validate config values can be deserialized
        # TODO -- some general purp deser

        # validate config values are mutually consistent
        # TODO -- block specific hook registration

        # calculate fable expansions
        # NOTE very simple now, simply source >> product >> sink. Eventually blocks would be able to decide on their own
        if blockFactory.kind == "source":
            possible_expansions[blockId] = blocksOfKind["product"]
        elif blockFactory.kind == "product":
            possible_expansions[blockId] = blocksOfKind["sink"]

    global_errors = []  # cant think of any rn

    return FableValidationExpansion(
        possible_sources=possible_sources,
        possible_expansions=possible_expansions,
        block_errors=block_errors,
        global_errors=global_errors,
    )


def compile(fable: FableBuilder) -> RawCascadeJob:
    # TODO instead something very much like api.execution.forecast_products_to_cascade
    return RawCascadeJob(
        job_type="raw_cascade_job",
        job_instance=JobInstance(tasks={}, edges=[]),
    )


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

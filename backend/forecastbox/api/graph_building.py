from itertools import groupby
from collections import defaultdict
from forecastbox.api.types.graph_building import (
    ActionKind,
    ActionFactoryId,
    ActionFactoryCatalog,
    GraphValidationExpansion,
    ActionFactory,
    ActionConfigurationOption,
    GraphBuilder,
)
from forecastbox.api.types import RawCascadeJob
from cascade.low.core import JobInstance

# NOTE this will not be hardcoded like this, but partially hardcoded in submodules and extended by plugins
catalog = ActionFactoryCatalog(
    factories={
        "model_forecast": ActionFactory(
            kind="source",
            title="Compute Model Forecast",
            description="Download initial conditions, run model forecast",
            configuration_options={
                "model": ActionConfigurationOption(title="Model Name", description="Locally available checkpoint to run", value_type="str"),
                "date": ActionConfigurationOption(
                    title="Initial Conditions DateTime", description="DateTime of the initial conditions", value_type="datetime"
                ),
                "lead_time": ActionConfigurationOption(title="Lead Time", description="Lead Time of the forecast", value_type="int"),
                "ensemble_members": ActionConfigurationOption(
                    title="Ensemble Members", description="How many ensemble member to use", value_type="int"
                ),
            },
            inputs=[],
        ),
        "mars_aifs_external": ActionFactory(
            kind="source",
            title="Download AIFS Forecast",
            description="Download an existing published AIFS forecast from MARS",
            configuration_options={
                "date": ActionConfigurationOption(
                    title="Initial Conditions DateTime", description="DateTime of the initial conditions", value_type="datetime"
                ),
                "lead_time": ActionConfigurationOption(title="Lead Time", description="Lead Time of the forecast", value_type="int"),
            },
            inputs=[],
        ),
        "product_123": ActionFactory(
            kind="product",
            title="Thingily-Dingily Index",
            description="Calculate the Thingily-Dingily index",
            configuration_options={
                "variables": ActionConfigurationOption(
                    title="Variables", description="Which variables (st, precip, cc, ...) to compute the index for", value_type="list[str]"
                ),
                "thingily-dingily-coefficient": ActionConfigurationOption(
                    title="Thingily-Dingily Coefficient", description="Coefficient of the Thingily-Dingiliness", value_type="float"
                ),
            },
            inputs=["forecast"],
        ),
        "product_456": ActionFactory(
            kind="product",
            title="Comparity-Romparity Ratio",
            description="Estimate the Comparity-Romparity ratio between two forecasts",
            configuration_options={},
            inputs=[
                "forecast1",
                "forecast2",
            ],  # NOTE this opens up an interesting question -- how to "tab-completion" with two inputs? My suggestion is to include this product as a possible completion to every source (as if it were a single-sourced product), but when the user clicks on it, the frontend recognizes "oh there are two inputs", and would give the user dialog with forecast1=the-action-user-clicked-on prefilled, and forecast2=(selection UI with every other action in the graph that had this product in its extension options). This will not work correctly if we have heterogeneous multiple inputs -- do we expect that? Like "compare model forecast to ground truth?"
        ),
        "store_local_fdb": ActionFactory(
            kind="sink",
            title="Local FDB persistence",
            description="Store any grib data to local fdb",
            configuration_options={
                "fdb_key_prefix": ActionConfigurationOption(title="FDB prefix", description="Like /experiments/run123", value_type="str"),
            },
            inputs=["data"],
        ),
        "plot": ActionFactory(
            kind="sink",
            description="Visualize",
            title="Visualize the result as a plot",
            configuration_options={
                "ekp_subcommand": ActionConfigurationOption(
                    title="Earthkit-Plots Subcommond", description="Full subcommand as understood by earthkit-plots", value_type="str"
                ),
            },
            inputs=["data"],
        ),
    }
)

actionsOfKind: dict[ActionKind, list[ActionFactoryId]] = {
    kind: [afk for (afk, _) in it] for kind, it in groupby(catalog.factories.items(), lambda afkv: afkv[1].kind)
}


def validate_expand(graph: GraphBuilder) -> GraphValidationExpansion:
    possible_sources = actionsOfKind["source"]
    possible_expansions = {}
    action_errors = defaultdict(list)
    for actionId, actionInstance in graph.actions.items():
        # validate basic consistency
        if actionId not in catalog:
            action_errors[actionId] += ["Action not found in the catalog"]
            continue
        actionFactory = catalog.factories[actionId]
        # NOTE ty does not support walrus correctly yet
        extraConfig = actionInstance.configuration_values.keys() - actionFactory.configuration_options.keys()
        if extraConfig:
            action_errors[actionId] += ["Action contains extra config: {extraConfig}"]
        missingConfig = actionFactory.configuration_options.keys() - actionInstance.configuration_values.keys()
        if missingConfig:
            # TODO most likely disable this, we would inject defaults at the compile level
            action_errors[actionId] += ["Action contains missing config: {missingConfig}"]

        # validate config values can be deserialized
        # TODO -- some general purp deser

        # validate config values are mutually consistent
        # TODO -- action specific hook registration

        # calculate graph expansions
        # NOTE very simple now, simply source >> product >> sink. Eventually actions would be able to decide on their own
        if actionFactory.kind == "source":
            possible_expansions[actionId] = actionsOfKind["product"]
        elif actionFactory.kind == "product":
            possible_expansions[actionId] = actionsOfKind["sink"]

    global_errors = []  # cant think of any rn

    return GraphValidationExpansion(
        possible_sources=possible_sources,
        possible_expansions=possible_expansions,
        action_errors=action_errors,
        global_errors=global_errors,
    )


def compile(graph: GraphBuilder) -> RawCascadeJob:
    # TODO instead something very much like api.execution.forecast_products_to_cascade
    return RawCascadeJob(
        job_type="raw_cascade_job",
        job_instance=JobInstance(tasks={}, edges=[]),
    )


"""
Further extension requirements (only as a comment to keep the first PR reasonably sized)
    - localization support -- presumably the /catalog endpoint will allow lang parameter and lookup translation strings
    - rich typing on the ActionConfigurationOptions, in particular we want:
      enum-fixed[1, 2, 3] -- so that frontend can show like radio
      enum-dynam[aifs1.0, aifs1.1, bris1.0] -- so that frontend can show like dropdown
      constant[42] -- just display non-editable field
    - configuration option prefills
      we want to set hard restrictions on admin level, like "always use 8 ensemble members for aifs1.0 model"
      we want to set overriddable defaults on any level, like "start with location: malawi for any model"
      => this would require endpoint "storeActionConfig", keyed by actionId and optionally any number of option keyvalues, and soft/hard bool
      => if keyed only by actionId, we can make do with existing interface; for the multikeyed we need to extend the ActionConfigurationOption
    - graph builder persistence -- we want a new endpoint that allows storing graph builder instances, for like favorites, quickstarts, work interrupts, etc
"""

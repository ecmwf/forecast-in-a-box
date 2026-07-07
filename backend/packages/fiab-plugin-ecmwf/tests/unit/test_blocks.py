# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


from datetime import datetime
from unittest.mock import MagicMock

import pytest
from earthkit.workflows.fluent import Action
from earthkit.workflows.nodetree import nodetree_dimensions
from fiab_core.fable import (
    BlockFactoryId,
    BlockInstanceId,
    ConfigurationOptionId,
    ConfigurationOptionRestriction,
    PluginBlockFactoryId,
    PluginCompositeId,
    QubedOutput,
    RawOutput,
)
from fiab_core.fable import (
    BlockInstance as BlockInstanceBase,
)
from fiab_core.tools.blocks import BlockInstanceRich as BlockInstance
from fiab_core.tools.blocks import QubedBlockBuilder
from qubed import Qube

from fiab_plugin_ecmwf import blocks as ecmwf_block_builders
from fiab_plugin_ecmwf import plugin
from fiab_plugin_ecmwf.anemoi.utils import get_checkpoint_enum_type
from fiab_plugin_ecmwf.block_utils import (
    DIMENSION,
    ENSEMBLE,
    PARAM,
    STEP,
    VALUES,
    _param_id_to_param_key,
)
from fiab_plugin_ecmwf.blocks import FORECAST_DATASETS, GribSink, MapPlotSink, OperationalForecastSource, Select, ZarrSink
from fiab_plugin_ecmwf.products.blocks import EnsembleStatistics
from fiab_plugin_ecmwf.qubed_utils import axes, collapse, contains


def _config(values: dict[str, object]) -> dict[ConfigurationOptionId, object]:
    return {ConfigurationOptionId(key): value for key, value in values.items()}


def _block_builder(factory_id: str) -> QubedBlockBuilder:
    return ecmwf_block_builders[BlockFactoryId(factory_id)]


def _block_instance(
    factory_id: str, values: dict[str, object], *, input_ids: dict[str, BlockInstanceId] | None = None
) -> BlockInstanceBase:
    return BlockInstanceBase(
        factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory=BlockFactoryId(factory_id)),
        input_ids=input_ids or {},
        configuration_values=_config(values),
    )


def _select() -> Select:
    block = _block_builder("select")
    assert isinstance(block, Select)
    return block


@pytest.fixture
def select_configuration() -> BlockInstance:
    return BlockInstance.from_block(
        _block_instance(
            "select",
            {
                "dimension": "param",
                "values": [_param_id_to_param_key("167")],
            },
            input_ids={"dataset": BlockInstanceId("source_output")},
        ),
        _select().configuration_options,
    )


@pytest.fixture
def zarr_sink_configuration() -> BlockInstance:
    return BlockInstance.from_block(
        _block_instance(
            "zarrSink",
            {
                "path": "/path/to/output.zarr",
            },
            input_ids={"dataset": BlockInstanceId("source_output")},
        ),
        ZarrSink.configuration_options,
    )


@pytest.fixture
def grib_sink_configuration() -> BlockInstance:
    return BlockInstance.from_block(
        BlockInstanceBase(
            factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="GribSink"),  # type: ignore
            input_ids={"dataset": BlockInstanceId("source_output")},
            configuration_values=_config(
                {
                    "path": "/path/to/output.grib2",
                }
            ),
        ),
        GribSink.configuration_options,
    )


@pytest.fixture
def map_plot_sink_configuration() -> BlockInstance:
    return BlockInstance.from_block(
        BlockInstanceBase(
            factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory=BlockFactoryId("mapPlotSink")),
            input_ids={"dataset": BlockInstanceId("source_output")},
            configuration_values=_config(
                {
                    "param": [_param_id_to_param_key("167")],
                    "domain": ["global"],
                    "format": "png",
                    "groupby": "step",
                    "splitby": [],
                }
            ),
        ),
        MapPlotSink.configuration_options,
    )


class TestOperationalForecastSource:
    @pytest.mark.parametrize("forecast", FORECAST_DATASETS.keys())
    def test_creation(self, dummy_blockinstance_output: QubedOutput, forecast: str) -> None:
        block = OperationalForecastSource()

        assert not block.intersect(other=dummy_blockinstance_output)  # type: ignore[arg-type]
        block_instance = BlockInstance.from_block(
            BlockInstanceBase(
                factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="OperationalForecastSource"),  # type: ignore
                input_ids={},
                configuration_values=_config(
                    dict(
                        {
                            "source": "ecmwf-open-data",
                            "base_time": datetime(2024, 1, 1),
                            "forecast": forecast,
                        },
                    )
                ),
            ),
            OperationalForecastSource.configuration_options,
        )
        output = block.validate(block=block_instance, inputs={}, restrictions={})  # type: ignore[assignment]
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        assert contains(output, "param")
        assert contains(output, "step")
        assert contains(output, "number")

    @pytest.mark.parametrize("forecast", ["aifs-ens", "ifs-ens"])
    @pytest.mark.parametrize("time", [0, 6])
    def test_compile_builds_action_from_catalogue(self, forecast: str, time: int) -> None:
        block = OperationalForecastSource()
        block_instance = BlockInstance.from_block(
            _block_instance(
                "operationalForecastSource",
                {
                    "source": "ecmwf-open-data",
                    "base_time": datetime(2024, 1, 1, time),
                    "forecast": forecast,
                },
            ),
            OperationalForecastSource.configuration_options,
        )
        action = block.compile({}, block_instance).get_or_raise()
        assert "levelist" in nodetree_dimensions(action.nodes)

    @pytest.mark.parametrize(
        "config, error",
        [
            [{"base_time": datetime(2024, 1, 1, 9)}, "Invalid time"],
        ],
    )
    def test_validate(self, config: dict, error: str) -> None:
        block = OperationalForecastSource()
        block_instance = BlockInstance.from_block(
            BlockInstanceBase(
                factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="OperationalForecastSource"),  # type: ignore
                input_ids={},
                configuration_values=_config(
                    dict(
                        {
                            "source": "ecmwf-open-data",
                            "base_time": datetime(2024, 1, 1),
                            "forecast": "ifs-ens",
                        },
                        **config,
                    )
                ),
            ),
            OperationalForecastSource.configuration_options,
        )
        with pytest.raises(Exception, match=error):
            block.validate(block=block_instance, inputs={}, restrictions={})  # type: ignore[assignment]

    def test_catalogue_value_types_are_canonical(self) -> None:
        assert (
            OperationalForecastSource.configuration_options[ConfigurationOptionId("source")].value_type
            == "enumClosed['mars', 'ecmwf-open-data']"
        )
        assert OperationalForecastSource.configuration_options[ConfigurationOptionId("base_time")].value_type == "datetime"
        assert PARAM not in OperationalForecastSource.configuration_options
        assert STEP not in OperationalForecastSource.configuration_options
        assert ENSEMBLE not in OperationalForecastSource.configuration_options


class TestZarrSink:
    def test_from_operational_forecast_source(
        self, zarr_sink_configuration: BlockInstance, operational_forecast_source_output: QubedOutput
    ) -> None:
        block = ZarrSink()

        assert block.intersect(other=operational_forecast_source_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=zarr_sink_configuration,
            inputs={"dataset": operational_forecast_source_output},  # type: ignore[dict-item],
            restrictions={},
        )
        assert isinstance(output, RawOutput)

    def test_from_ensemble_statistics(
        self,
        zarr_sink_configuration: BlockInstance,
        ensemble_statistics_configuration: BlockInstance,
        operational_forecast_source_output: QubedOutput,
    ) -> None:
        ensemble_block = EnsembleStatistics()
        ensemble_output = ensemble_block.validate(  # type: ignore[assignment]
            block=ensemble_statistics_configuration,
            inputs={"dataset": operational_forecast_source_output},  # type: ignore[dict-item],
            restrictions={},
        )
        block = ZarrSink()

        assert block.intersect(other=ensemble_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=zarr_sink_configuration,
            inputs={"dataset": ensemble_output},  # type: ignore[dict-item],
            restrictions={},
        )
        assert isinstance(output, RawOutput)

    def test_compile(
        self,
        operational_forecast_source_output: QubedOutput,
        operational_forecast_source_action: Action,
        zarr_sink_configuration: BlockInstance,
    ) -> None:
        block = ZarrSink()
        block.validate(block=zarr_sink_configuration, inputs={"dataset": operational_forecast_source_output}, restrictions={})  # type: ignore[dict-item]
        action = block.compile(
            inputs={BlockInstanceId("source_output"): operational_forecast_source_action},
            block=zarr_sink_configuration,
        ).get_or_raise()
        assert action.nodes.dims == {}


class TestSelect:
    def test_catalogue_value_types_are_canonical(self) -> None:
        assert _select().configuration_options[DIMENSION].value_type == "str"
        assert _select().configuration_options[VALUES].value_type == "list[str]"

    def test_from_operational_forecast_source(
        self, select_configuration: BlockInstance, operational_forecast_source_output: QubedOutput
    ) -> None:
        block = _select()
        assert block.intersect(other=operational_forecast_source_output)  # type: ignore[arg-type]
        output = block.validate(block=select_configuration, inputs={"dataset": operational_forecast_source_output}, restrictions={})  # type: ignore[dict-item]
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        assert axes(output)[PARAM] == {"167"}

    def test_from_operational_forecast_source_multiple_parameters(
        self, select_configuration: BlockInstance, operational_forecast_source_output: QubedOutput
    ) -> None:
        block = _select()
        config = select_configuration.model_copy(
            update={
                "configuration_values": _config(
                    {"dimension": "param", "values": [_param_id_to_param_key("167"), _param_id_to_param_key("151")]}
                )
            }
        )
        output = block.validate(block=config, inputs={"dataset": operational_forecast_source_output}, restrictions={})  # type: ignore[dict-item]
        assert isinstance(output, QubedOutput)
        assert axes(output)[PARAM] == {"167", "151"}

    def test_selects_integer_dimension_from_string_values(
        self, select_configuration: BlockInstance, operational_forecast_source_output: QubedOutput
    ) -> None:
        block = _select()
        config = select_configuration.model_copy(update={"configuration_values": _config({"dimension": "step", "values": ["0", "6"]})})
        output = block.validate(block=config, inputs={"dataset": operational_forecast_source_output}, restrictions={})  # type: ignore[dict-item]
        assert isinstance(output, QubedOutput)
        assert axes(output)[STEP] == {0, 6}

    def test_validate_rejects_empty_selection_after_axis_membership_passes(self, select_configuration: BlockInstance) -> None:
        block = _select()
        broken_qube = Qube.make_root([Qube.make_node("step", [6, 12], Qube.from_datacube({"param": ["2t"]}).children)])
        input_dataset = QubedOutput(dataqube=broken_qube)
        config = select_configuration.model_copy(update={"configuration_values": _config({"dimension": "step", "values": ["6"]})})

        with pytest.raises(Exception, match="produced an empty dataset"):
            block.validate(block=config, inputs={"dataset": input_dataset}, restrictions={})

    def test_validate_rejects_unknown_dimension(
        self, select_configuration: BlockInstance, operational_forecast_source_output: QubedOutput
    ) -> None:
        block = _select()
        config = select_configuration.model_copy(update={"configuration_values": _config({"dimension": "missing", "values": ["2t"]})})
        restrictions: ConfigurationOptionRestriction = {}
        with pytest.raises(Exception, match="dimension missing is not in the input dimensions"):
            block.validate(block=config, inputs={"dataset": operational_forecast_source_output}, restrictions=restrictions)  # type: ignore[dict-item]
        assert DIMENSION in restrictions
        assert VALUES not in restrictions

    def test_validate_rejects_unknown_values(
        self, select_configuration: BlockInstance, operational_forecast_source_output: QubedOutput
    ) -> None:
        block = _select()
        config = select_configuration.model_copy(update={"configuration_values": _config({"dimension": "param", "values": ["missing"]})})
        restrictions: ConfigurationOptionRestriction = {}
        with pytest.raises(Exception, match="values.*are not in dimension param"):
            block.validate(block=config, inputs={"dataset": operational_forecast_source_output}, restrictions=restrictions)  # type: ignore[dict-item]
        assert DIMENSION in restrictions
        assert VALUES in restrictions

    def test_validator_adds_dimension_restrictions(
        self, select_configuration: BlockInstance, operational_forecast_source_output: QubedOutput
    ) -> None:
        restrictions = plugin().validator(select_configuration, {"dataset": operational_forecast_source_output}).restrictions
        restriction = restrictions[DIMENSION].serialize()
        assert restriction.startswith("enumClosed[")
        assert "param" in restriction
        assert "step" in restriction
        assert "number" in restriction

    def test_validator_adds_values_for_selected_dimension(
        self, select_configuration: BlockInstance, operational_forecast_source_output: QubedOutput
    ) -> None:
        config = select_configuration.model_copy(update={"configuration_values": _config({"dimension": "step", "values": ["0"]})})
        restrictions = plugin().validator(config, {"dataset": operational_forecast_source_output}).restrictions
        assert restrictions[VALUES].serialize() == "list[enumClosed[0,6,12]]"

    def test_validator_keeps_restrictions_when_configuration_is_missing(
        self, select_configuration: BlockInstance, operational_forecast_source_output: QubedOutput
    ) -> None:
        config = select_configuration.model_copy(update={"configuration_values": _config({"dimension": "step"})})
        validation = plugin().validator(config, {"dataset": operational_forecast_source_output})
        assert validation.result.e is not None
        assert DIMENSION in validation.restrictions
        assert VALUES in validation.restrictions

    def test_compile_calls_select(self, select_configuration: BlockInstance) -> None:
        block = _select()
        input_action = MagicMock()
        selected_action = MagicMock()
        input_action.select.return_value = selected_action

        result = block.compile(inputs={BlockInstanceId("source_output"): input_action}, block=select_configuration)  # type: ignore[dict-item]
        assert result.t is selected_action
        input_action.select.assert_called_once_with({PARAM: "167"}, expand=True)

    def test_compile_calls_select_with_integer_values(self, select_configuration: BlockInstance) -> None:
        block = _select()
        input_action = MagicMock()
        selected_action = MagicMock()
        input_action.select.return_value = selected_action
        config = select_configuration.model_copy(update={"configuration_values": _config({"dimension": "step", "values": ["0", "6"]})})

        result = block.compile(inputs={BlockInstanceId("source_output"): input_action}, block=config)  # type: ignore[dict-item]
        assert result.t is selected_action
        input_action.select.assert_called_once_with({STEP: [0, 6]})

    def test_expander_offers_select_without_static_restrictions(self, operational_forecast_source_output: QubedOutput) -> None:
        expansions = plugin().expander(operational_forecast_source_output)
        select_expansion = next(expansion for expansion in expansions if expansion.factory == BlockFactoryId("select"))
        assert select_expansion.restrictions == {}


def test_anemoi_catalogue_value_types_are_canonical(registered_provider: None) -> None:
    assert get_checkpoint_enum_type() == "enumClosed['dummy_store:dummy_ckpt']"


class TestGribSink:
    def test_from_operational_forecast_source(
        self, grib_sink_configuration: BlockInstance, operational_forecast_source_output: QubedOutput
    ) -> None:
        block = GribSink()

        assert block.intersect(other=operational_forecast_source_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=grib_sink_configuration,
            inputs={"dataset": operational_forecast_source_output},  # type: ignore[dict-item],
            restrictions={},
        )
        assert isinstance(output, RawOutput)

    def test_from_ensemble_statistics(
        self,
        grib_sink_configuration: BlockInstance,
        ensemble_statistics_configuration: BlockInstance,
        operational_forecast_source_output: QubedOutput,
    ) -> None:
        ensemble_block = EnsembleStatistics()
        ensemble_output = ensemble_block.validate(  # type: ignore[assignment]
            block=ensemble_statistics_configuration,
            inputs={"dataset": operational_forecast_source_output},  # type: ignore[dict-item],
            restrictions={},
        )
        block = GribSink()

        assert block.intersect(other=ensemble_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=grib_sink_configuration,
            inputs={"dataset": ensemble_output},  # type: ignore[dict-item],
            restrictions={},
        )
        assert isinstance(output, RawOutput)

    @pytest.mark.parametrize(
        "filepath",
        [
            "/path/to/output.grib",
            "/path/to/{param}.grib",
            "/path/to/{shortName}.grib",
            "/path/to/{param}_{shortName}_{step}.grib",
        ],
    )
    def test_validate_template_values(self, operational_forecast_source_output: QubedOutput, filepath: str) -> None:
        block = GribSink()
        config = BlockInstance.from_block(
            BlockInstanceBase(
                factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="GribSink"),  # type: ignore
                input_ids={"dataset": BlockInstanceId("source_output")},
                configuration_values=_config(
                    {
                        "path": filepath,
                    }
                ),
            ),
            GribSink.configuration_options,
        )
        output = block.validate(  # type: ignore[assignment]
            block=config,
            inputs={"dataset": operational_forecast_source_output},  # type: ignore[dict-item]
            restrictions={},
        )
        assert isinstance(output, RawOutput)

    def test_invalid_path(self, operational_forecast_source_output: QubedOutput) -> None:
        block = GribSink()
        config = BlockInstance.from_block(
            BlockInstanceBase(
                factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="GribSink"),  # type: ignore
                input_ids={"dataset": BlockInstanceId("source_output")},
                configuration_values=_config(
                    {
                        "path": "/path/to/[param]/[step].grib",
                    }
                ),
            ),
            GribSink.configuration_options,
        )
        with pytest.raises(Exception, match="Invalid filepath: directory path can not contain template values"):
            block.validate(
                block=config,
                inputs={"dataset": operational_forecast_source_output},  # type: ignore[dict-item]
                restrictions={},
            )

    @pytest.mark.parametrize(
        "filepath, dims",
        [
            ["/path/to/output.grib", {}],
            ["/path/to/[param].grib", {"param": 3}],
            ["/path/to/[param]_[shortName]_[step].grib", {"param": 3, "step": 3}],
            ["/path/to/[stepRange]_[number]_[non_dim].grib", {"step": 3, "number": 5}],
        ],
    )
    def test_compile(
        self,
        operational_forecast_source_output: QubedOutput,
        operational_forecast_source_action: Action,
        filepath: str,
        dims: dict[str, int],
    ) -> None:
        block = GribSink()
        config = BlockInstance.from_block(
            BlockInstanceBase(
                factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="GribSink"),  # type: ignore
                input_ids={"dataset": BlockInstanceId("source_output")},
                configuration_values=_config(
                    {
                        "path": filepath,
                    }
                ),
            ),
            GribSink.configuration_options,
        )
        block.validate(block=config, inputs={"dataset": operational_forecast_source_output}, restrictions={})  # type: ignore[dict-item]
        action = block.compile(inputs={BlockInstanceId("source_output"): operational_forecast_source_action}, block=config).get_or_raise()
        assert action.nodes.dims == dims


class TestMapPlotSink:
    def test_intersect_from_operational_forecast_source(self, operational_forecast_source_output: QubedOutput) -> None:
        block = MapPlotSink()
        assert block.intersect(other=operational_forecast_source_output)  # type: ignore[arg-type]

    def test_intersect_rejects_empty(self, dummy_blockinstance_output: QubedOutput) -> None:
        block = MapPlotSink()
        assert not block.intersect(other=dummy_blockinstance_output)  # type: ignore[arg-type]

    def test_intersect_rejects_no_param(self, operational_forecast_source_output: QubedOutput) -> None:
        block = MapPlotSink()
        collapsed = collapse(operational_forecast_source_output, "param")
        assert not block.intersect(other=collapsed)  # type: ignore[arg-type]

    def test_validator_adds_parameters_restrictions(
        self, map_plot_sink_configuration: BlockInstance, operational_forecast_source_output: QubedOutput
    ) -> None:
        restrictions = plugin().validator(map_plot_sink_configuration, {"dataset": operational_forecast_source_output}).restrictions
        assert (
            restrictions[PARAM].serialize()
            == f"list[enumClosed[{_param_id_to_param_key('167')},{_param_id_to_param_key('151')},{_param_id_to_param_key('131')}]]"
        )

    def test_expander_has_no_parameters_restrictions(self, operational_forecast_source_output: QubedOutput) -> None:
        expansions = plugin().expander(operational_forecast_source_output)
        map_plot_expansion = next(expansion for expansion in expansions if expansion.factory == BlockFactoryId("mapPlotSink"))
        assert map_plot_expansion.restrictions == {}

    def test_expander_skips_restriction_for_non_string_axes(self) -> None:
        output = QubedOutput(dataqube=Qube.from_datacube({"param": [1, 2]}))
        expansions = plugin().expander(output)
        map_plot_expansion = next(expansion for expansion in expansions if expansion.factory == BlockFactoryId("mapPlotSink"))
        assert PARAM not in map_plot_expansion.restrictions

    def test_validate_from_operational_forecast_source(
        self, map_plot_sink_configuration: BlockInstance, operational_forecast_source_output: QubedOutput
    ) -> None:
        block = MapPlotSink()
        output = block.validate(
            block=map_plot_sink_configuration,
            inputs={"dataset": operational_forecast_source_output},
            restrictions={},  # type: ignore[dict-item]
        )
        assert isinstance(output, RawOutput)
        assert output.type_fqn == "bytes"
        assert output.mime_type == "image/png"

    @pytest.mark.parametrize(
        ("fmt", "expected_mime"),
        [
            ("png", "image/png"),
            ("pdf", "application/pdf"),
            ("svg", "image/svg+xml"),
        ],
    )
    def test_validate_sets_mime_from_format(self, fmt: str, expected_mime: str, operational_forecast_source_output: QubedOutput) -> None:
        block = MapPlotSink()
        config = BlockInstance.from_block(
            BlockInstanceBase(
                factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory=BlockFactoryId("MapPlotSink")),  # type: ignore
                input_ids={"dataset": BlockInstanceId("source_output")},
                configuration_values=_config(
                    {
                        "param": [_param_id_to_param_key("167")],
                        "domain": ["global"],
                        "format": fmt,
                        "groupby": "none",
                        "splitby": [],
                    }
                ),
            ),
            MapPlotSink.configuration_options,
        )
        output = block.validate(block=config, inputs={"dataset": operational_forecast_source_output}, restrictions={})  # type: ignore[dict-item]
        assert isinstance(output, RawOutput)
        assert output.type_fqn == "bytes"
        assert output.mime_type == expected_mime

    def test_validate_multi_param(self, operational_forecast_source_output: QubedOutput) -> None:
        block = MapPlotSink()
        config = BlockInstance.from_block(
            BlockInstanceBase(
                factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory=BlockFactoryId("MapPlotSink")),  # type: ignore
                input_ids={"dataset": BlockInstanceId("source_output")},
                configuration_values=_config(
                    {
                        "param": [_param_id_to_param_key("167"), _param_id_to_param_key("151")],
                        "domain": ["global"],
                        "format": "png",
                        "groupby": "none",
                        "splitby": [],
                    }
                ),
            ),
            MapPlotSink.configuration_options,
        )
        output = block.validate(block=config, inputs={"dataset": operational_forecast_source_output}, restrictions={})  # type: ignore[dict-item]
        assert isinstance(output, RawOutput)

    def test_validate_rejects_unknown_param(self, operational_forecast_source_output: QubedOutput) -> None:
        block = MapPlotSink()
        config = BlockInstance.from_block(
            BlockInstanceBase(
                factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory=BlockFactoryId("MapPlotSink")),  # type: ignore
                input_ids={"dataset": BlockInstanceId("source_output")},
                configuration_values=_config(
                    {
                        "param": ["nonexistent"],
                        "domain": ["global"],
                        "format": "png",
                        "groupby": "none",
                        "splitby": [],
                    }
                ),
            ),
            MapPlotSink.configuration_options,
        )
        restrictions: ConfigurationOptionRestriction = {}
        with pytest.raises(Exception, match="nonexistent"):
            block.validate(block=config, inputs={"dataset": operational_forecast_source_output}, restrictions=restrictions)  # type: ignore[dict-item]
        assert PARAM in restrictions

    def test_validate_rejects_partial_unknown_params(self, operational_forecast_source_output: QubedOutput) -> None:
        block = MapPlotSink()
        config = BlockInstance.from_block(
            BlockInstanceBase(
                factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory=BlockFactoryId("MapPlotSink")),  # type: ignore
                input_ids={"dataset": BlockInstanceId("source_output")},
                configuration_values=_config(
                    {
                        "param": [_param_id_to_param_key("167"), "nonexistent"],
                        "domain": ["global"],
                        "format": "png",
                        "groupby": "none",
                        "splitby": [],
                    }
                ),
            ),
            MapPlotSink.configuration_options,
        )
        restrictions: ConfigurationOptionRestriction = {}
        with pytest.raises(Exception, match="nonexistent"):
            block.validate(block=config, inputs={"dataset": operational_forecast_source_output}, restrictions=restrictions)  # type: ignore[dict-item]
        assert PARAM in restrictions

    def test_validate_from_ensemble_statistics(
        self,
        map_plot_sink_configuration: BlockInstance,
        ensemble_statistics_configuration: BlockInstance,
        operational_forecast_source_output: QubedOutput,
    ) -> None:
        ensemble_output = EnsembleStatistics().validate(
            block=ensemble_statistics_configuration,
            inputs={"dataset": operational_forecast_source_output},
            restrictions={},
        )

        block = MapPlotSink()
        assert block.intersect(other=ensemble_output)  # type: ignore[arg-type]
        output = block.validate(block=map_plot_sink_configuration, inputs={"dataset": ensemble_output}, restrictions={})  # type: ignore[dict-item]
        assert isinstance(output, RawOutput)

    @pytest.mark.parametrize("groupby", ["none", "number"])
    def test_compile_groupby(
        self, operational_forecast_source_output: QubedOutput, operational_forecast_source_action: Action, groupby: str
    ) -> None:
        block = MapPlotSink()
        config = BlockInstance.from_block(
            BlockInstanceBase(
                factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory=BlockFactoryId("MapPlotSink")),  # type: ignore
                input_ids={"dataset": BlockInstanceId("source_output")},
                configuration_values=_config(
                    {
                        "param": [_param_id_to_param_key("167"), _param_id_to_param_key("151")],
                        "domain": ["global"],
                        "format": "png",
                        "groupby": groupby,
                        "splitby": [],
                    }
                ),
            ),
            MapPlotSink.configuration_options,
        )
        block.validate(block=config, inputs={"dataset": operational_forecast_source_output}, restrictions={})  # type: ignore[dict-item]
        action = block.compile(inputs={BlockInstanceId("source_output"): operational_forecast_source_action}, block=config).get_or_raise()
        assert action.nodes.dims == {}

    def test_validate_splitby(self, operational_forecast_source_output: QubedOutput) -> None:
        block = MapPlotSink()
        config = BlockInstance.from_block(
            BlockInstanceBase(
                factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory=BlockFactoryId("MapPlotSink")),  # type: ignore
                input_ids={"dataset": BlockInstanceId("source_output")},
                configuration_values=_config(
                    {
                        "param": [_param_id_to_param_key("167"), _param_id_to_param_key("151")],
                        "domain": ["global"],
                        "format": "png",
                        "groupby": "none",
                        "splitby": ["none", "param"],
                    }
                ),
            ),
            MapPlotSink.configuration_options,
        )
        with pytest.raises(Exception, match="Invalid splitby value: if none is selected, no other dimensions can be present"):
            block.validate(block=config, inputs={"dataset": operational_forecast_source_output}, restrictions={})  # type: ignore[dict-item]

    @pytest.mark.parametrize(
        "splitby, dims", [[[], {}], [["none"], {}], [["number"], {"number": 5}], [["number", "step"], {"number": 5, "step": 3}]]
    )
    def test_compile_splitby(
        self,
        operational_forecast_source_output: QubedOutput,
        operational_forecast_source_action: Action,
        splitby: str,
        dims: dict[str, int],
    ) -> None:
        block = MapPlotSink()
        config = BlockInstance.from_block(
            BlockInstanceBase(
                factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory=BlockFactoryId("MapPlotSink")),  # type: ignore
                input_ids={"dataset": BlockInstanceId("source_output")},
                configuration_values=_config(
                    {
                        "param": [_param_id_to_param_key("151"), _param_id_to_param_key("167")],
                        "domain": ["global"],
                        "format": "png",
                        "groupby": "none",
                        "splitby": splitby,
                    }
                ),
            ),
            MapPlotSink.configuration_options,
        )
        block.validate(block=config, inputs={"dataset": operational_forecast_source_output}, restrictions={})  # type: ignore[dict-item]
        action = block.compile(inputs={BlockInstanceId("source_output"): operational_forecast_source_action}, block=config).get_or_raise()
        assert action.nodes.dims == dims

# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the geography blocks (GeographicalTransform)."""

from typing import Any

import pytest
from earthkit.workflows.fluent import Action
from earthkit.workflows.nodetree import nodetree_arrays
from fiab_core.fable import BlockFactoryId, BlockInstanceId, ConfigurationOptionId, QubedOutput
from fiab_core.fable import BlockInstance as BlockInstanceBase
from fiab_core.tools.blocks import BlockInstanceConfigurationError
from fiab_core.tools.blocks import BlockInstanceRich as BlockInstance
from fiab_core.types import GeoDomainType, GridType, GridValue, WrongType
from qubed import Qube

from fiab_plugin_ecmwf import plugin
from fiab_plugin_ecmwf.constants import DOMAIN, GRID
from fiab_plugin_ecmwf.geography.blocks import GeographicalTransform, domain_axis_value, domain_runtime_value, grid_axis_value
from fiab_plugin_ecmwf.qubed_utils import axes

REGRID_TASK = "fiab_plugin_ecmwf.geography.runtime.regrid"
REGRID_ENVIRONMENT = ["mir-python", "earthkit-plots<1.0.0"]

SOURCE_ID = BlockInstanceId("source_output")

# Values as they reach the block once the configuration types have converted the frontend strings
BBOX_WSEN = [-10.0, 35.0, 30.0, 60.0]
BBOX_NWSE = [60.0, -10.0, 35.0, 30.0]


def _config(values: dict[str, object]) -> dict[ConfigurationOptionId, object]:
    return {ConfigurationOptionId(key): value for key, value in values.items()}


def _block(grid: object, domain: object) -> BlockInstance:
    return BlockInstance.from_block(
        BlockFactoryId("geographicalTransform"),
        BlockInstanceBase(
            input_ids={"dataset": SOURCE_ID},
            configuration_values=_config({"grid": grid, "domain": domain}),
        ),
        GeographicalTransform.configuration_options,
    )


def _regrid_nodes(action: Action) -> list[Any]:
    nodes = []
    for _, arr in nodetree_arrays(action.nodes):
        for node in arr.values.flat:
            if hasattr(node, "payload") and node.payload.definition.entrypoint == REGRID_TASK:
                nodes.append(node)
    return nodes


class TestGridOption:
    value_type = GeographicalTransform.configuration_options[GRID].value_type

    def test_declared_as_grid_type(self) -> None:
        assert isinstance(self.value_type, GridType)
        assert self.value_type.serialize() == "grid"

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("O96", "O96"),
            ("N320", "N320"),
            ("0.25", 0.25),
            ("1", 1.0),
            ("0.25/0.5", [0.25, 0.5]),
            ("1/2", [1.0, 2.0]),
            ("auto", None),
        ],
    )
    def test_valid(self, raw: str, expected: object) -> None:
        assert self.value_type.validate_convert(raw) == expected

    @pytest.mark.parametrize(
        "raw",
        ["", "N", "F320", "X96", "0", "-0.25", "0.25/-0.5", "0.25/abc", "abc", "O9.6", "inf", "-inf", "nan", "1/2/3", "0.25/inf"],
    )
    def test_invalid(self, raw: str) -> None:
        with pytest.raises(WrongType):
            self.value_type.validate_convert(raw)

    def test_default_is_auto(self) -> None:
        default = GeographicalTransform.configuration_options[GRID].default_value
        assert default == "auto"
        assert self.value_type.validate_convert(default) is None


class TestDomainOption:
    value_type = GeographicalTransform.configuration_options[DOMAIN].value_type

    def test_declared_as_geodomain_type(self) -> None:
        assert isinstance(self.value_type, GeoDomainType)
        assert self.value_type.serialize() == "geodomain"

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("auto", "auto"),
            ("global", "global"),
            ("Germany", ["Germany"]),
            ("Germany,France", ["Germany", "France"]),
            ("-10,35,30,60", BBOX_WSEN),
            ("-10.5,35.25,30.5,60.75", [-10.5, 35.25, 30.5, 60.75]),
            ("170,-10,-170,10", [170.0, -10.0, -170.0, 10.0]),
        ],
    )
    def test_valid(self, raw: str, expected: object) -> None:
        assert self.value_type.validate_convert(raw) == expected

    @pytest.mark.parametrize(
        "raw",
        [
            "-10,95,30,60",
            "-10,60,30,35",
            "-10,35,30",
            "1,2,3,4,5",
            "nan,35,30,60",
            "0.5,1",
        ],
    )
    def test_invalid(self, raw: str) -> None:
        with pytest.raises(WrongType):
            self.value_type.validate_convert(raw)

    def test_default_is_auto(self) -> None:
        default = GeographicalTransform.configuration_options[DOMAIN].default_value
        assert default == "auto"
        assert self.value_type.validate_convert(default) == "auto"


class TestGridAxisValue:
    @pytest.mark.parametrize(
        ("grid", "expected"),
        [
            ("O96", "O96"),
            ("N320", "N320"),
            (0.25, "0.25"),
            (1.0, "1"),
            (1, "1"),
            (0.1, "0.1"),
            (0.125, "0.125"),
            (100.0, "100"),
            (0.00001, "0.00001"),
            ([0.25, 0.5], "0.25/0.5"),
            ([1.0, 2.0], "1/2"),
            ([1, 2], "1/2"),
            ([0.5, 1.0], "0.5/1"),
        ],
    )
    def test_canonical_string(self, grid: GridValue, expected: str) -> None:
        assert grid_axis_value(grid) == expected

    @pytest.mark.parametrize("raw", ["0.25", "1", "0.25/0.5", "1/2", "O96", "0.1/0.1"])
    def test_converted_grid_round_trips_through_canonical_string(self, raw: str) -> None:
        value_type = GeographicalTransform.configuration_options[GRID].value_type
        converted = value_type.validate_convert(raw)
        assert converted is not None
        assert grid_axis_value(converted) == raw

    def test_pair_order_is_preserved(self) -> None:
        assert grid_axis_value([1, 2]) != grid_axis_value([2, 1])


class TestDomainValues:
    @pytest.mark.parametrize(
        ("domain", "axis", "runtime"),
        [
            ("auto", "auto", None),
            ("global", "global", None),
            ("datadefined", "datadefined", None),
            ([], "auto", None),
            (["Germany"], "Germany", "Germany"),
            (BBOX_NWSE, str(BBOX_NWSE), BBOX_NWSE),
        ],
    )
    def test_domain_values(self, domain: Any, axis: str, runtime: object) -> None:
        assert domain_axis_value(domain) == axis
        assert domain_runtime_value(domain) == runtime

    def test_multiple_named_domains_rejected(self) -> None:
        with pytest.raises(BlockInstanceConfigurationError, match="Only one string domain"):
            domain_axis_value(["Germany", "France"])
        with pytest.raises(BlockInstanceConfigurationError, match="Only one string domain"):
            domain_runtime_value(["Germany", "France"])


class TestBlockInstanceAccessors:
    @pytest.mark.parametrize(
        ("grid", "expected"),
        [("O96", "O96"), (0.25, 0.25), ([0.25, 0.5], [0.25, 0.5]), (None, None)],
    )
    def test_config_as_grid(self, grid: object, expected: object) -> None:
        assert _block(grid, "auto").config_as_grid(GRID) == expected

    def test_config_as_grid_rejects_unexpected_python_type(self) -> None:
        with pytest.raises(BlockInstanceConfigurationError, match="expected str, list"):
            _block({"a": 1}, "auto").config_as_grid(GRID)

    def test_config_as_grid_rejects_bool(self) -> None:
        with pytest.raises(BlockInstanceConfigurationError, match="got bool"):
            _block(True, "auto").config_as_grid(GRID)

    def test_config_as_grid_rejects_non_grid_option(self) -> None:
        with pytest.raises(BlockInstanceConfigurationError, match="not GridType"):
            _block("O96", "auto").config_as_grid(DOMAIN)

    def test_bbox_is_reordered_to_nwse(self) -> None:
        assert _block(None, BBOX_WSEN).config_as_geodomain(DOMAIN).with_bbox_mars().value == BBOX_NWSE


class TestGeographicalTransformValidate:
    def test_declares_single_dataset_input(self) -> None:
        assert GeographicalTransform().inputs == ["dataset"]

    @pytest.mark.parametrize(
        ("grid", "domain", "expected_grid", "expected_domain"),
        [
            (None, "auto", None, "auto"),
            (None, "global", None, "global"),
            (None, "datadefined", None, "datadefined"),
            ("O96", "global", "O96", "global"),
            ("N320", "auto", "N320", "auto"),
            (0.25, "auto", "0.25", "auto"),
            (1.0, "global", "1", "global"),
            (1, "global", "1", "global"),
            ([0.25, 0.5], "auto", "0.25/0.5", "auto"),
            ([1.0, 2.0], "global", "1/2", "global"),
            ([1, 2], ["Germany"], "1/2", "Germany"),
            (0.25, ["Germany"], "0.25", "Germany"),
            (None, BBOX_WSEN, None, str(BBOX_NWSE)),
            ("O96", BBOX_WSEN, "O96", str(BBOX_NWSE)),
            ([0.25, 0.5], BBOX_WSEN, "0.25/0.5", str(BBOX_NWSE)),
            (None, [], None, "auto"),
            ("O96", [], "O96", "auto"),
            ([0.25, 0.5], [], "0.25/0.5", "auto"),
        ],
    )
    def test_validate_sets_grid_and_domain_axes(
        self,
        sample_forecast_source_output: QubedOutput,
        grid: object,
        domain: object,
        expected_grid: str | None,
        expected_domain: str,
    ) -> None:
        output = GeographicalTransform().validate(
            block=_block(grid, domain),
            inputs={"dataset": sample_forecast_source_output},
            restrictions={},  # type: ignore[arg-type]
        )
        assert isinstance(output, QubedOutput)
        output_axes = axes(output)
        if expected_grid is None:
            assert "grid" not in output_axes
        else:
            assert output_axes["grid"] == {expected_grid}
        assert output_axes["domain"] == {expected_domain}
        assert output_axes["param"] == axes(sample_forecast_source_output)["param"]
        assert output_axes["step"] == axes(sample_forecast_source_output)["step"]

    def test_validate_empty_area_does_not_put_empty_list_on_axis(self, sample_forecast_source_output: QubedOutput) -> None:
        output = GeographicalTransform().validate(
            block=_block("O96", []),
            inputs={"dataset": sample_forecast_source_output},
            restrictions={},  # type: ignore[arg-type]
        )
        assert isinstance(output, QubedOutput)
        assert all("[" not in str(value) for value in axes(output)["domain"])

    def test_validate_replaces_existing_grid_axis(self, sample_forecast_source_output: QubedOutput) -> None:
        block = GeographicalTransform()
        once = block.validate(
            block=_block("O96", "global"),
            inputs={"dataset": sample_forecast_source_output},
            restrictions={},  # type: ignore[arg-type]
        )
        assert isinstance(once, QubedOutput)
        twice = block.validate(
            block=_block([0.25, 0.5], BBOX_WSEN),
            inputs={"dataset": once},
            restrictions={},  # type: ignore[arg-type]
        )
        assert isinstance(twice, QubedOutput)
        assert axes(twice)["grid"] == {"0.25/0.5"}
        assert axes(twice)["domain"] == {str(BBOX_NWSE)}

    def test_validate_keeps_existing_grid_axis_when_grid_is_auto(self, sample_forecast_source_output: QubedOutput) -> None:
        block = GeographicalTransform()
        once = block.validate(
            block=_block("O96", "global"),
            inputs={"dataset": sample_forecast_source_output},
            restrictions={},  # type: ignore[arg-type]
        )
        assert isinstance(once, QubedOutput)
        twice = block.validate(block=_block(None, "global"), inputs={"dataset": once}, restrictions={})  # type: ignore[arg-type]
        assert isinstance(twice, QubedOutput)
        assert axes(twice)["grid"] == {"O96"}

    def test_validate_rejects_multiple_named_domains(self, sample_forecast_source_output: QubedOutput) -> None:
        with pytest.raises(ValueError, match="Only one string domain"):
            GeographicalTransform().validate(
                block=_block(None, ["Germany", "France"]),
                inputs={"dataset": sample_forecast_source_output},
                restrictions={},  # type: ignore[arg-type]
            )

    def test_validate_rejects_non_qubed_input(self) -> None:
        with pytest.raises(BlockInstanceConfigurationError, match="Unsupported input type"):
            GeographicalTransform().validate(block=_block(None, "auto"), inputs={}, restrictions={})  # type: ignore[arg-type]

    def test_validate_requires_domain_axis_in_input(self) -> None:
        no_domain = QubedOutput(dataqube=Qube.from_datacube({"param": ["167"], "step": [0, 6]}))
        with pytest.raises(ValueError, match="'domain' not in dataqube dimensions"):
            GeographicalTransform().validate(block=_block(None, "global"), inputs={"dataset": no_domain}, restrictions={})  # type: ignore[arg-type]

    def test_validate_through_plugin(self, sample_forecast_source_output: QubedOutput) -> None:
        validation = plugin().validator(
            BlockFactoryId("geographicalTransform"),
            _block("O96", "global").block,
            {"dataset": sample_forecast_source_output},
        )
        output = validation.result.get_or_raise()
        assert isinstance(output, QubedOutput)
        assert axes(output)["domain"] == {"global"}


class TestGeographicalTransformExpand:
    def test_expander_offers_block_for_dataset(self, sample_forecast_source_output: QubedOutput) -> None:
        factories = [expansion.factory for expansion in plugin().expander(sample_forecast_source_output)]
        assert BlockFactoryId("geographicalTransform") in factories

    def test_intersect_accepts_dataset(self, sample_forecast_source_output: QubedOutput) -> None:
        assert GeographicalTransform().intersect(sample_forecast_source_output)

    def test_expansion_has_no_restrictions(self, sample_forecast_source_output: QubedOutput) -> None:
        expansion = next(
            expansion for expansion in plugin().expander(sample_forecast_source_output) if expansion.factory == "geographicalTransform"
        )
        assert expansion.restrictions == {}

    def test_catalogue_entry(self) -> None:
        catalogue = plugin().catalogue.factories[BlockFactoryId("geographicalTransform")]
        assert catalogue.kind == "transform"
        assert set(catalogue.configuration_options) == {GRID, DOMAIN}
        assert catalogue.inputs == ["dataset"]


class TestGeographicalTransformCompile:
    @pytest.mark.parametrize(
        ("grid", "domain", "expected_grid", "expected_domain"),
        [
            ("O96", "global", "O96", None),
            ("N320", "auto", "N320", None),
            (0.25, "datadefined", 0.25, None),
            ([0.25, 0.5], "global", [0.25, 0.5], None),
            (None, "global", None, None),
            (None, "auto", None, None),
            ([0.5, 1.0], ["Germany"], [0.5, 1.0], "Germany"),
            ([0.25, 0.5], BBOX_WSEN, [0.25, 0.5], BBOX_NWSE),
            ("O96", [], "O96", None),
            (0.25, [], 0.25, None),
            ([0.25, 0.5], [], [0.25, 0.5], None),
            (None, [], None, None),
            (0.25, ["Germany"], 0.25, "Germany"),
            ("O96", ["Europe"], "O96", "Europe"),
            ("N320", BBOX_WSEN, "N320", BBOX_NWSE),
            (0.1, [170.0, -10.0, -170.0, 10.0], 0.1, [10.0, 170.0, -10.0, -170.0]),
        ],
    )
    def test_compile_builds_regrid_task(
        self,
        sample_forecast_source_action: Action,
        grid: object,
        domain: object,
        expected_grid: object,
        expected_domain: object,
    ) -> None:
        action = (
            GeographicalTransform().compile(inputs={SOURCE_ID: sample_forecast_source_action}, block=_block(grid, domain)).get_or_raise()
        )

        nodes = _regrid_nodes(action)
        assert len(nodes) > 0
        for node in nodes:
            assert node.payload.definition.entrypoint == REGRID_TASK
            assert node.payload.static_input_kw == {"grid": expected_grid, "domain": expected_domain, "fmt_if_list": "nwse"}

    def test_compile_sets_environment_requirements(self, sample_forecast_source_action: Action) -> None:
        action = (
            GeographicalTransform().compile(inputs={SOURCE_ID: sample_forecast_source_action}, block=_block("O96", "global")).get_or_raise()
        )

        nodes = _regrid_nodes(action)
        assert len(nodes) > 0
        for node in nodes:
            assert set(node.metadata.requirements.environment) == set(REGRID_ENVIRONMENT)

    def test_compile_maps_over_every_input_node(self, sample_forecast_source_action: Action) -> None:
        action = (
            GeographicalTransform().compile(inputs={SOURCE_ID: sample_forecast_source_action}, block=_block("O96", "global")).get_or_raise()
        )

        input_node_count = sum(arr.values.size for _, arr in nodetree_arrays(sample_forecast_source_action.nodes))
        assert len(_regrid_nodes(action)) == input_node_count

    def test_compile_through_plugin_wraps_in_base_environment(self, sample_forecast_source_action: Action) -> None:
        either = plugin().compiler(
            {SOURCE_ID: sample_forecast_source_action}, BlockFactoryId("geographicalTransform"), _block("O96", "global").block
        )
        action = either.get_or_raise()

        nodes = _regrid_nodes(action)
        assert len(nodes) > 0
        environment = list(nodes[0].metadata.requirements.environment)
        assert all(requirement in environment for requirement in REGRID_ENVIRONMENT)

    def test_compile_rejects_multiple_named_domains(self, sample_forecast_source_action: Action) -> None:
        with pytest.raises(BlockInstanceConfigurationError, match="Only one string domain"):
            GeographicalTransform().compile(inputs={SOURCE_ID: sample_forecast_source_action}, block=_block("O96", ["Germany", "France"]))

    def test_compile_through_plugin_reports_multiple_named_domains_as_error(self, sample_forecast_source_action: Action) -> None:
        either = plugin().compiler(
            {SOURCE_ID: sample_forecast_source_action},
            BlockFactoryId("geographicalTransform"),
            _block("O96", ["Germany", "France"]).block,
        )
        assert either.e is not None

    def test_compile_missing_input_raises(self) -> None:
        with pytest.raises(KeyError):
            GeographicalTransform().compile(inputs={}, block=_block("O96", "global"))

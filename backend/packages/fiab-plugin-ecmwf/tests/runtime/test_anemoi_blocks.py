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
from earthkit.workflows import fluent, nodetree
from fiab_core.artifacts import CompositeArtifactId
from fiab_core.fable import BlockFactoryId, BlockInstanceId, ConfigurationOptionId, QubedOutput
from fiab_core.fable import BlockInstance as BlockInstanceBase
from fiab_core.tools.blocks import BlockInstanceConfigurationError
from fiab_core.tools.blocks import BlockInstanceRich as BlockInstance
from fiab_core.types import UnionType, WrongType, parse
from pytest_lazy_fixtures import lf
from qubed import Qube

from fiab_plugin_ecmwf import plugin
from fiab_plugin_ecmwf.anemoi.blocks import ENSEMBLE_MEMBERS_TYPE, AnemoiBuilder, AnemoiInputSource, AnemoiSource, AnemoiTransform
from fiab_plugin_ecmwf.anemoi.utils import CheckpointArtifact, get_checkpoint_enum_type
from fiab_plugin_ecmwf.constants import ENSEMBLE
from fiab_plugin_ecmwf.qubed_utils import axes, collapse, contains, datacubes, expand

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _config(values: dict[str, object]) -> dict[ConfigurationOptionId, object]:
    return {ConfigurationOptionId(key): value for key, value in values.items()}


def _make_block(
    factory_cls: type[AnemoiSource | AnemoiInputSource | AnemoiTransform],
    config: dict,
    input_ids: dict | None = None,
) -> BlockInstance:
    """Build a *typed* BlockInstanceRich whose configuration values have already
    been converted to the correct Python types (int, datetime, …)."""
    base = BlockInstanceBase(
        input_ids=input_ids or {},
        configuration_values=_config(config),
    )
    return BlockInstance.from_block(BlockFactoryId(factory_cls.__name__), base, factory_cls.configuration_options)  # type: ignore[arg-type]


def _make_raw_block(
    factory_cls: type[AnemoiSource | AnemoiInputSource | AnemoiTransform],
    config: dict,
    input_ids: dict | None = None,
) -> BlockInstance:
    """Build a BlockInstanceRich whose configuration values are *raw strings*
    (as they would arrive from the frontend before deserialisation)."""
    base = BlockInstanceBase(
        input_ids=input_ids or {},
        configuration_values=_config(config),
    )
    return BlockInstance.from_block(BlockFactoryId(factory_cls.__name__), base, factory_cls.configuration_options)  # type: ignore[arg-type]


def _set_ensemble_model(monkeypatch: pytest.MonkeyPatch, value: bool | None) -> None:
    """Make the dummy checkpoint report itself as an ensemble (True), non-ensemble (False) or unknown (None) model."""
    monkeypatch.setattr(CheckpointArtifact, "is_ensemble_model", property(lambda self: value))


@pytest.fixture
def non_ensemble_model(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_ensemble_model(monkeypatch, False)


@pytest.fixture
def unknown_model(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_ensemble_model(monkeypatch, None)


@pytest.fixture
def ensemble_model(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_ensemble_model(monkeypatch, True)


def _with_members(output: QubedOutput, members: list[int]) -> QubedOutput:
    """Replace the `number` axis of an output (if any) by the given members"""
    if contains(output, "number"):  # type: ignore[arg-type]
        output = collapse(output, "number")  # type: ignore[assignment]
    return expand(output, {ENSEMBLE: members})  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Fixtures - block configurations
# ---------------------------------------------------------------------------


@pytest.fixture
def anemoi_source_configuration(dummy_checkpoint: CompositeArtifactId) -> BlockInstance:
    return _make_block(
        AnemoiSource,
        {
            "checkpoint": dummy_checkpoint,
            "input_source": "opendata",
            "lead_time": 24,
            "base_time": datetime(2024, 1, 1),
            "number": "none",
        },
    )


@pytest.fixture
def anemoi_source_ensemble_configuration(ensemble_model: None, dummy_checkpoint: CompositeArtifactId) -> BlockInstance:
    return _make_block(
        AnemoiSource,
        {
            "checkpoint": dummy_checkpoint,
            "input_source": "opendata",
            "lead_time": 24,
            "base_time": datetime(2024, 1, 1),
            "number": [3],
        },
    )


@pytest.fixture
def anemoi_input_source_configuration(dummy_checkpoint: CompositeArtifactId) -> BlockInstance:
    return _make_block(
        AnemoiInputSource,
        {
            "checkpoint": dummy_checkpoint,
            "input_source": "opendata",
            "base_time": datetime(2024, 1, 1),
            "number": "none",
        },
    )


@pytest.fixture
def anemoi_transform_configuration(dummy_checkpoint: CompositeArtifactId) -> BlockInstance:
    return _make_block(
        AnemoiTransform,
        {"checkpoint": dummy_checkpoint, "lead_time": 24},
        input_ids={"initial conditions": "src"},
    )


# ---------------------------------------------------------------------------
# Fixtures - validated outputs
# ---------------------------------------------------------------------------


@pytest.fixture
def anemoi_source_output(anemoi_source_configuration: BlockInstance) -> QubedOutput:
    return AnemoiSource().validate(block=anemoi_source_configuration, inputs={}, restrictions={})  # type: ignore[return-value]


@pytest.fixture
def anemoi_source_ensemble_output(anemoi_source_ensemble_configuration: BlockInstance) -> QubedOutput:
    return AnemoiSource().validate(block=anemoi_source_ensemble_configuration, inputs={}, restrictions={})  # type: ignore[return-value]


@pytest.fixture
def anemoi_input_source_output(anemoi_input_source_configuration: BlockInstance) -> QubedOutput:
    return AnemoiInputSource().validate(block=anemoi_input_source_configuration, inputs={}, restrictions={})  # type: ignore[return-value]


class TestCheckpointArtifact:
    def test_model_output_selects_multiple_steps_with_metadata(self, six_hour_dummy_checkpoint: CompositeArtifactId) -> None:
        output = CheckpointArtifact(six_hour_dummy_checkpoint).get_model_output(lead_time=48)

        assert isinstance(output, Qube)
        selected = output.select({"step": lambda step: step in {6, 12, 30, 24}})
        assert axes(selected)["step"] == {6, 12, 24, 30}
        assert list(selected.leaves(metadata=True))


# ---------------------------------------------------------------------------
# Fixtures - validated actions
# ---------------------------------------------------------------------------


@pytest.fixture
def anemoi_source_action(anemoi_source_configuration: BlockInstance) -> fluent.Action:
    return AnemoiSource().compile(inputs={}, block=anemoi_source_configuration).get_or_raise()  # type: ignore[return-value]


@pytest.fixture
def anemoi_source_ensemble_action(anemoi_source_ensemble_configuration: BlockInstance) -> fluent.Action:
    return AnemoiSource().compile(inputs={}, block=anemoi_source_ensemble_configuration).get_or_raise()  # type: ignore[return-value]


@pytest.fixture
def anemoi_input_source_action(anemoi_input_source_configuration: BlockInstance) -> fluent.Action:
    return AnemoiInputSource().compile(inputs={}, block=anemoi_input_source_configuration).get_or_raise()  # type: ignore[return-value]


# ===================================================================
# AnemoiSource
# ===================================================================


class TestAnemoiSourceValidate:
    """Validate method - happy paths and error paths."""

    def test_valid_deterministic(self, anemoi_source_configuration: BlockInstance) -> None:
        output = AnemoiSource().validate(block=anemoi_source_configuration, inputs={}, restrictions={})
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None

    def test_non_ensemble_model_has_no_number_axis(self, non_ensemble_model: None, anemoi_source_configuration: BlockInstance) -> None:
        output = AnemoiSource().validate(block=anemoi_source_configuration, inputs={}, restrictions={})
        assert not contains(output, "number")  # type: ignore[arg-type]

    def test_deterministic_has_param_axis(self, anemoi_source_output: QubedOutput) -> None:
        assert contains(anemoi_source_output, "param")

    def test_deterministic_has_step_axis(self, anemoi_source_output: QubedOutput) -> None:
        assert contains(anemoi_source_output, "step")

    def test_ensemble_has_number_axis(self, anemoi_source_ensemble_output: QubedOutput) -> None:
        assert contains(anemoi_source_ensemble_output, "number")
        assert set(axes(anemoi_source_ensemble_output)["number"]) == {3}

    def test_ensemble_preserves_param_axis(self, anemoi_source_ensemble_output: QubedOutput) -> None:
        assert contains(anemoi_source_ensemble_output, "param")

    def test_has_basetime(self, anemoi_source_output: QubedOutput) -> None:
        assert contains(anemoi_source_output, "date")
        assert set(axes(anemoi_source_output)["date"]) == {"20240101"}

    def test_invalid_lead_time_not_a_digit(self, dummy_checkpoint: CompositeArtifactId) -> None:
        block = _make_raw_block(
            AnemoiSource,
            {"checkpoint": dummy_checkpoint, "lead_time": "abc", "base_time": "2024-01-01", "number": [1]},
        )
        with pytest.raises(BlockInstanceConfigurationError, match="expected int"):
            AnemoiSource().validate(
                block=block,
                inputs={},
                restrictions={},
            )

    def test_invalid_lead_time_negative(self, dummy_checkpoint: CompositeArtifactId) -> None:
        block = _make_block(
            AnemoiSource,
            {"checkpoint": dummy_checkpoint, "lead_time": -1, "base_time": datetime(2024, 1, 1), "number": [1]},
        )
        with pytest.raises(Exception, match="must be greater than checkpoint timestep"):
            AnemoiSource().validate(
                block=block,
                inputs={},
                restrictions={},
            )

    def test_invalid_lead_time_equal_to_timestep(self, dummy_checkpoint: CompositeArtifactId) -> None:
        block = _make_block(
            AnemoiSource,
            {"checkpoint": dummy_checkpoint, "lead_time": 1, "base_time": datetime(2024, 1, 1), "number": [1]},
        )
        with pytest.raises(Exception, match="must be greater than checkpoint timestep"):
            AnemoiSource().validate(block=block, inputs={}, restrictions={})

    def test_invalid_lead_time_not_a_timestep_multiple(self, six_hour_dummy_checkpoint: CompositeArtifactId) -> None:
        block = _make_block(
            AnemoiSource,
            {"checkpoint": six_hour_dummy_checkpoint, "lead_time": 7, "base_time": datetime(2024, 1, 1), "number": [1]},
        )
        with pytest.raises(Exception, match="must be a multiple of checkpoint timestep"):
            AnemoiSource().validate(block=block, inputs={}, restrictions={})

    @pytest.mark.parametrize("block_cls", [AnemoiSource, AnemoiInputSource])
    def test_number_option_is_none_or_list_of_non_negative_ints(self, block_cls: type[AnemoiSource | AnemoiInputSource]) -> None:
        option = block_cls.configuration_options[ENSEMBLE]
        assert isinstance(option.value_type, UnionType)
        assert option.value_type.serialize() == "union[enumClosed[str]('none'),list[int{nonNegative}]]"

    @pytest.mark.parametrize("block_cls", [AnemoiSource, AnemoiInputSource])
    def test_number_default_is_none(self, block_cls: type[AnemoiSource | AnemoiInputSource]) -> None:
        """The default is a non-empty string, as the frontend flags an empty value as missing"""
        option = block_cls.configuration_options[ENSEMBLE]
        assert option.default_value == "none"
        assert option.value_type.validate_convert(option.default_value) == "none"
        assert "control" in option.description

    @pytest.mark.parametrize(
        "raw, expected",
        [
            ["none", "none"],
            ["", []],
            ["0", [0]],
            ["5", [5]],
            ["1,2,3", [1, 2, 3]],
            ["3, 1, 2", [3, 1, 2]],
        ],
    )
    def test_number_accepts_none_or_member_lists(self, raw: str, expected: str | list[int]) -> None:
        """Member 0 (control) is valid, and the order given by the user is preserved."""
        value_type = AnemoiSource.configuration_options[ENSEMBLE].value_type
        assert value_type.validate_convert(raw) == expected

    @pytest.mark.parametrize("raw", ["1,-1", "-1", "two", "none,1", "None"])
    def test_invalid_number(self, raw: str) -> None:
        """Negativity is enforced by the NonNegative trait on the item type, checked at FableType.validate_convert
        time -- before a block's configuration values ever reach validate()."""
        value_type = AnemoiSource.configuration_options[ENSEMBLE].value_type
        with pytest.raises(WrongType):
            value_type.validate_convert(raw)

    def test_number_round_trips_through_the_type_parser(self) -> None:
        value_type = AnemoiSource.configuration_options[ENSEMBLE].value_type
        assert parse(value_type.serialize()).serialize() == value_type.serialize()

    @pytest.mark.parametrize("model", ["ensemble_model", "non_ensemble_model", "unknown_model"])
    @pytest.mark.parametrize("number", ["none", [], None], ids=["none", "empty", "absent"])
    def test_no_members_is_valid(
        self, request: pytest.FixtureRequest, model: str, number: str | list[int] | None, dummy_checkpoint: CompositeArtifactId
    ) -> None:
        """No members ("none", an empty list, or the option absent) is valid for every model type: ensemble models run the
        control member, other models run deterministically with no `number` axis."""
        request.getfixturevalue(model)
        config: dict = {"checkpoint": dummy_checkpoint, "lead_time": 24, "base_time": datetime(2024, 1, 1)}
        if number is not None:
            config["number"] = number
        output = AnemoiSource().validate(block=_make_block(AnemoiSource, config), inputs={}, restrictions={})
        if model == "ensemble_model":
            assert axes(output)["number"] == {0}  # type: ignore[arg-type]
        else:
            assert not contains(output, "number")  # type: ignore[arg-type]

    def test_invalid_number_not_a_digit(self, dummy_checkpoint: CompositeArtifactId) -> None:
        block = _make_raw_block(
            AnemoiSource,
            {"checkpoint": dummy_checkpoint, "lead_time": "24", "base_time": "2024-01-01", "number": ["two"]},
        )
        with pytest.raises(BlockInstanceConfigurationError, match="expected 'none' or list\\[int\\]"):
            AnemoiSource().validate(
                block=block,
                inputs={},
                restrictions={},
            )

    @pytest.mark.parametrize("members", [[0], [5], [1, 2, 3], [3, 1, 2]])
    def test_ensemble_model_accepts_member_lists(
        self, ensemble_model: None, dummy_checkpoint: CompositeArtifactId, members: list[int]
    ) -> None:
        block = _make_block(
            AnemoiSource,
            {"checkpoint": dummy_checkpoint, "lead_time": 24, "base_time": datetime(2024, 1, 1), "number": members},
        )
        output = AnemoiSource().validate(block=block, inputs={}, restrictions={})
        assert set(axes(output)["number"]) == set(members)  # type: ignore[arg-type]

    def test_ensemble_model_without_members_runs_control_member(
        self, ensemble_model: None, anemoi_source_configuration: BlockInstance
    ) -> None:
        output = AnemoiSource().validate(block=anemoi_source_configuration, inputs={}, restrictions={})
        assert axes(output)["number"] == {0}  # type: ignore[arg-type]

    @pytest.mark.parametrize("model", ["non_ensemble_model", "unknown_model"])
    def test_deterministic_model_has_dates_but_no_number_axis(
        self, request: pytest.FixtureRequest, model: str, anemoi_source_configuration: BlockInstance
    ) -> None:
        """Non-ensemble and unknown models run deterministically: no `number` axis, but date and time are still added"""
        request.getfixturevalue(model)
        output = AnemoiSource().validate(block=anemoi_source_configuration, inputs={}, restrictions={})
        assert not contains(output, "number")  # type: ignore[arg-type]
        assert axes(output)["date"] == {"20240101"}  # type: ignore[arg-type]
        assert axes(output)["time"] == {"0000"}  # type: ignore[arg-type]
        assert contains(output, "param")  # type: ignore[arg-type]
        assert contains(output, "step")  # type: ignore[arg-type]

    def test_unset_number_defaults_to_control_member(self, ensemble_model: None, dummy_checkpoint: CompositeArtifactId) -> None:
        """With no `number` set by the user the option default ("none") applies, so an ensemble model runs the control member 0"""
        option = AnemoiSource.configuration_options[ENSEMBLE]
        default = option.value_type.validate_convert(option.default_value)
        block = _make_block(
            AnemoiSource,
            {"checkpoint": dummy_checkpoint, "lead_time": 24, "base_time": datetime(2024, 1, 1), "number": default},
        )
        output = AnemoiSource().validate(block=block, inputs={}, restrictions={})
        assert axes(output)["number"] == {0}  # type: ignore[arg-type]

    def test_builder_from_input_defaults_to_control_member(
        self, monkeypatch: pytest.MonkeyPatch, ensemble_model: None, dummy_checkpoint: CompositeArtifactId
    ) -> None:
        inference = MagicMock()
        monkeypatch.setattr(AnemoiBuilder, "inference", inference)
        monkeypatch.setattr(AnemoiBuilder, "_add_extra_output_keys", lambda self, action: action)
        builder = AnemoiBuilder(dummy_checkpoint)
        builder.from_input(input_source="opendata", date=datetime(2024, 1, 1), lead_time=24)
        assert inference.return_value.from_input.call_args.kwargs["ensemble_members"] == [0]
        builder.from_input(input_source="opendata", date=datetime(2024, 1, 1), lead_time=24, ensemble=[])
        assert inference.return_value.from_input.call_args.kwargs["ensemble_members"] == [0]

    def test_builder_get_initial_conditions_defaults_to_control_member(
        self, monkeypatch: pytest.MonkeyPatch, ensemble_model: None, dummy_checkpoint: CompositeArtifactId
    ) -> None:
        get_initial_conditions = MagicMock()
        monkeypatch.setattr("fiab_plugin_ecmwf.anemoi.blocks.get_initial_conditions", get_initial_conditions)
        monkeypatch.setattr(AnemoiBuilder, "_local_path", property(lambda self: "ckpt"))
        builder = AnemoiBuilder(dummy_checkpoint)
        builder.get_initial_conditions(input_source="opendata", date=datetime(2024, 1, 1))
        assert get_initial_conditions.call_args.kwargs["ensemble_members"] == [0]
        builder.get_initial_conditions(input_source="opendata", date=datetime(2024, 1, 1), ensemble=[])
        assert get_initial_conditions.call_args.kwargs["ensemble_members"] == [0]

    @pytest.mark.parametrize("model", ["non_ensemble_model", "unknown_model"])
    def test_builder_from_input_is_deterministic_for_non_ensemble_models(
        self, request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch, model: str, dummy_checkpoint: CompositeArtifactId
    ) -> None:
        request.getfixturevalue(model)
        inference = MagicMock()
        monkeypatch.setattr(AnemoiBuilder, "inference", inference)
        monkeypatch.setattr(AnemoiBuilder, "_add_extra_output_keys", lambda self, action: action)
        builder = AnemoiBuilder(dummy_checkpoint)
        builder.from_input(input_source="opendata", date=datetime(2024, 1, 1), lead_time=24, ensemble=[])
        assert inference.return_value.from_input.call_args.kwargs["ensemble_members"] is None

    @pytest.mark.parametrize("model", ["non_ensemble_model", "unknown_model"])
    def test_builder_get_initial_conditions_is_deterministic_for_non_ensemble_models(
        self, request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch, model: str, dummy_checkpoint: CompositeArtifactId
    ) -> None:
        request.getfixturevalue(model)
        get_initial_conditions = MagicMock()
        monkeypatch.setattr("fiab_plugin_ecmwf.anemoi.blocks.get_initial_conditions", get_initial_conditions)
        monkeypatch.setattr(AnemoiBuilder, "_local_path", property(lambda self: "ckpt"))
        builder = AnemoiBuilder(dummy_checkpoint)
        builder.get_initial_conditions(input_source="opendata", date=datetime(2024, 1, 1), ensemble=[])
        assert get_initial_conditions.call_args.kwargs["ensemble_members"] is None

    def test_builder_passes_member_list_for_ensemble_models(
        self, monkeypatch: pytest.MonkeyPatch, ensemble_model: None, dummy_checkpoint: CompositeArtifactId
    ) -> None:
        inference = MagicMock()
        monkeypatch.setattr(AnemoiBuilder, "inference", inference)
        monkeypatch.setattr(AnemoiBuilder, "_add_extra_output_keys", lambda self, action: action)
        builder = AnemoiBuilder(dummy_checkpoint)
        builder.from_input(input_source="opendata", date=datetime(2024, 1, 1), lead_time=24, ensemble=[3, 1])
        assert inference.return_value.from_input.call_args.kwargs["ensemble_members"] == [3, 1]

    def test_non_ensemble_model_accepts_no_members(self, non_ensemble_model: None, anemoi_source_configuration: BlockInstance) -> None:
        output = AnemoiSource().validate(block=anemoi_source_configuration, inputs={}, restrictions={})
        assert not contains(output, "number")  # type: ignore[arg-type]

    @pytest.mark.parametrize("members", [[0], [1], [2], [1, 2], [5, 1], [0, 1]])
    def test_non_ensemble_model_rejects_any_members(
        self, non_ensemble_model: None, dummy_checkpoint: CompositeArtifactId, members: list[int]
    ) -> None:
        block = _make_block(
            AnemoiSource,
            {"checkpoint": dummy_checkpoint, "lead_time": 24, "base_time": datetime(2024, 1, 1), "number": members},
        )
        with pytest.raises(ValueError, match="not an ensemble model, so ensemble members cannot be set"):
            AnemoiSource().validate(block=block, inputs={}, restrictions={})

    def test_unknown_model_accepts_no_members(self, unknown_model: None, anemoi_source_configuration: BlockInstance) -> None:
        output = AnemoiSource().validate(block=anemoi_source_configuration, inputs={}, restrictions={})
        assert not contains(output, "number")  # type: ignore[arg-type]

    @pytest.mark.parametrize("members", [[0], [1], [2], [1, 2], [5, 1], [0, 1]])
    def test_unknown_model_rejects_any_members(
        self, unknown_model: None, dummy_checkpoint: CompositeArtifactId, members: list[int]
    ) -> None:
        """Unknown models run deterministically, so are treated like non-ensemble models"""
        block = _make_block(
            AnemoiSource,
            {"checkpoint": dummy_checkpoint, "lead_time": 24, "base_time": datetime(2024, 1, 1), "number": members},
        )
        with pytest.raises(ValueError, match="not known to be an ensemble model, so ensemble members cannot be set"):
            AnemoiSource().validate(block=block, inputs={}, restrictions={})

    @pytest.mark.parametrize("model", ["non_ensemble_model", "unknown_model"])
    def test_deterministic_model_restricts_members_to_none(
        self, request: pytest.FixtureRequest, model: str, anemoi_source_configuration: BlockInstance
    ) -> None:
        request.getfixturevalue(model)
        restrictions: dict = {}
        AnemoiSource().validate(block=anemoi_source_configuration, inputs={}, restrictions=restrictions)
        assert set(restrictions) == {"lead_time", "number"}
        assert restrictions["number"].serialize() == "enumClosed[str]('none')"
        assert restrictions["number"].validate_convert("none") == "none"
        with pytest.raises(WrongType):
            restrictions["number"].validate_convert("1")

    def test_ensemble_model_restricts_members_to_the_option_type(
        self, ensemble_model: None, anemoi_source_configuration: BlockInstance
    ) -> None:
        """The restriction replaces one the frontend may still hold from a previously selected deterministic checkpoint"""
        restrictions: dict = {}
        AnemoiSource().validate(block=anemoi_source_configuration, inputs={}, restrictions=restrictions)
        assert restrictions["number"] is ENSEMBLE_MEMBERS_TYPE

    def test_restrictions_are_reported_with_the_rejection(self, non_ensemble_model: None, dummy_checkpoint: CompositeArtifactId) -> None:
        block = _make_block(
            AnemoiSource,
            {"checkpoint": dummy_checkpoint, "lead_time": 24, "base_time": datetime(2024, 1, 1), "number": [1]},
        )
        restrictions: dict = {}
        with pytest.raises(ValueError, match="ensemble members cannot be set"):
            AnemoiSource().validate(block=block, inputs={}, restrictions=restrictions)
        assert restrictions["number"].serialize() == "enumClosed[str]('none')"

    def test_explicit_none_runs_control_member(self, ensemble_model: None, dummy_checkpoint: CompositeArtifactId) -> None:
        block = _make_block(
            AnemoiSource,
            {"checkpoint": dummy_checkpoint, "lead_time": 24, "base_time": datetime(2024, 1, 1), "number": "none"},
        )
        output = AnemoiSource().validate(block=block, inputs={}, restrictions={})
        assert axes(output)["number"] == {0}  # type: ignore[arg-type]

    @pytest.mark.parametrize("model", ["non_ensemble_model", "unknown_model"])
    def test_compile_passes_no_members_for_deterministic_models(
        self, request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch, model: str, anemoi_source_configuration: BlockInstance
    ) -> None:
        """The block reads "none" as no members, which the builder passes to the library as `None` for these models"""
        request.getfixturevalue(model)
        inference = MagicMock()
        monkeypatch.setattr(AnemoiBuilder, "inference", inference)
        monkeypatch.setattr(AnemoiBuilder, "_add_extra_output_keys", lambda self, action: action)
        AnemoiSource().compile(inputs={}, block=anemoi_source_configuration)
        assert inference.return_value.from_input.call_args.kwargs["ensemble_members"] is None

    def test_compile_passes_control_member_for_none_on_ensemble_models(
        self, monkeypatch: pytest.MonkeyPatch, ensemble_model: None, anemoi_source_configuration: BlockInstance
    ) -> None:
        inference = MagicMock()
        monkeypatch.setattr(AnemoiBuilder, "inference", inference)
        monkeypatch.setattr(AnemoiBuilder, "_add_extra_output_keys", lambda self, action: action)
        AnemoiSource().compile(inputs={}, block=anemoi_source_configuration)
        assert inference.return_value.from_input.call_args.kwargs["ensemble_members"] == [0]

    def test_rejected_members_error_through_the_plugin_validator(self, unknown_model: None, dummy_checkpoint: CompositeArtifactId) -> None:
        """The plugin reports the rejection as an error on the block, with a message telling the user what to do"""
        block = BlockInstanceBase(
            input_ids={},
            configuration_values=_config(
                {"checkpoint": dummy_checkpoint, "lead_time": 24, "base_time": datetime(2024, 1, 1), "number": [1]}
            ),
        )
        validation = plugin().validator(BlockFactoryId("anemoiSource"), block, {})
        assert validation.result.t is None
        assert validation.result.e is not None
        assert "ensemble members cannot be set" in validation.result.e.reason
        assert 'Set the ensemble members to "none"' in validation.result.e.reason
        assert validation.restrictions[ENSEMBLE].serialize() == "enumClosed[str]('none')"

    def test_unknown_checkpoint(self, registered_provider: None) -> None:
        block = _make_block(
            AnemoiSource,
            {
                "checkpoint": CompositeArtifactId.from_str("dummy_store:unknown"),
                "lead_time": 24,
                "base_time": datetime(2024, 1, 1),
                "number": [1],
            },
        )
        with pytest.raises(Exception):
            AnemoiSource().validate(block=block, inputs={}, restrictions={})


class TestAnemoiSourceIntersect:
    """Sources always reject intersection - they are roots."""

    def test_rejects_qubed_output(self, anemoi_source_output: QubedOutput) -> None:
        assert not AnemoiSource().intersect(other=anemoi_source_output)  # type: ignore[arg-type]

    def test_rejects_empty_qubed_output(self) -> None:
        assert not AnemoiSource().intersect(other=QubedOutput())  # type: ignore[arg-type]

    def test_rejects_mock(self) -> None:
        assert not AnemoiSource().intersect(other=MagicMock())  # type: ignore[arg-type]


class TestAnemoiSourceCompile:
    @pytest.mark.parametrize(
        "source_output, source_action, exclude_keys",
        [
            [lf("anemoi_source_output"), lf("anemoi_source_action"), ["dataset"]],
            [lf("anemoi_source_ensemble_output"), lf("anemoi_source_ensemble_action"), ["dataset"]],
        ],
    )
    def test_compile(self, source_output: QubedOutput, source_action: fluent.Action, exclude_keys: list[str]) -> None:
        action_datacubes = nodetree.datacubes(source_action.nodes)
        for index, cube in enumerate(datacubes(source_output)):
            assert set(cube.keys()) == set(x for x in action_datacubes[index] if x not in exclude_keys)
            assert all(cube[dim] == action_datacubes[index][dim] for dim in cube)


class TestAnemoiSourceCompileWithoutMembers:
    def test_ensemble_model_compiles_to_the_control_member_it_advertises(
        self, ensemble_model: None, anemoi_source_configuration: BlockInstance
    ) -> None:
        """No members requested: an ensemble model advertises and runs member 0"""
        output = AnemoiSource().validate(block=anemoi_source_configuration, inputs={}, restrictions={})
        action = AnemoiSource().compile(inputs={}, block=anemoi_source_configuration).get_or_raise()
        assert axes(output)["number"] == {0}  # type: ignore[arg-type]
        action_datacubes = nodetree.datacubes(action.nodes)  # type: ignore[union-attr]
        for index, cube in enumerate(datacubes(output)):  # type: ignore[arg-type]
            assert set(cube.keys()) == set(x for x in action_datacubes[index] if x != "dataset")
            assert all(cube[dim] == action_datacubes[index][dim] for dim in cube)


class TestEnsembleMembersConsistent:
    """The members advertised by the validated qube match those passed to earthkit-workflows-anemoi."""

    @pytest.mark.parametrize("members", [[0, 5], [3, 1, 2]])
    def test_source(
        self, monkeypatch: pytest.MonkeyPatch, ensemble_model: None, dummy_checkpoint: CompositeArtifactId, members: list[int]
    ) -> None:
        from_input = MagicMock()
        monkeypatch.setattr(AnemoiBuilder, "from_input", from_input)
        block = _make_block(
            AnemoiSource,
            {
                "checkpoint": dummy_checkpoint,
                "input_source": "opendata",
                "lead_time": 24,
                "base_time": datetime(2024, 1, 1),
                "number": members,
            },
        )
        output = AnemoiSource().validate(block=block, inputs={}, restrictions={})
        AnemoiSource().compile(inputs={}, block=block)

        advertised = sorted(axes(output)["number"])  # type: ignore[arg-type]
        assert advertised == sorted(members)
        passed = from_input.call_args.kwargs["ensemble"]
        assert passed == members
        assert sorted(passed) == advertised

    @pytest.mark.parametrize("members", [[0, 5], [3, 1, 2]])
    def test_input_source(
        self, monkeypatch: pytest.MonkeyPatch, ensemble_model: None, dummy_checkpoint: CompositeArtifactId, members: list[int]
    ) -> None:
        get_initial_conditions = MagicMock()
        monkeypatch.setattr(AnemoiBuilder, "get_initial_conditions", get_initial_conditions)
        block = _make_block(
            AnemoiInputSource,
            {"checkpoint": dummy_checkpoint, "input_source": "opendata", "base_time": datetime(2024, 1, 1), "number": members},
        )
        output = AnemoiInputSource().validate(block=block, inputs={}, restrictions={})
        AnemoiInputSource().compile(inputs={}, block=block)

        advertised = sorted(axes(output)["number"])  # type: ignore[arg-type]
        assert advertised == sorted(members)
        passed = get_initial_conditions.call_args.kwargs["ensemble"]
        assert passed == members
        assert sorted(passed) == advertised


class TestEnsembleMembersPassedToLibrary:
    """The member list, in the order given, reaches earthkit-workflows-anemoi unchanged."""

    def test_source_passes_list(self, monkeypatch: pytest.MonkeyPatch, dummy_checkpoint: CompositeArtifactId) -> None:
        from_input = MagicMock()
        monkeypatch.setattr(AnemoiBuilder, "from_input", from_input)
        block = _make_block(
            AnemoiSource,
            {
                "checkpoint": dummy_checkpoint,
                "input_source": "opendata",
                "lead_time": 24,
                "base_time": datetime(2024, 1, 1),
                "number": [3, 1, 2],
            },
        )
        AnemoiSource().compile(inputs={}, block=block)
        assert from_input.call_args.kwargs["ensemble"] == [3, 1, 2]

    def test_input_source_passes_list(self, monkeypatch: pytest.MonkeyPatch, dummy_checkpoint: CompositeArtifactId) -> None:
        get_initial_conditions = MagicMock()
        monkeypatch.setattr(AnemoiBuilder, "get_initial_conditions", get_initial_conditions)
        block = _make_block(
            AnemoiInputSource,
            {"checkpoint": dummy_checkpoint, "input_source": "opendata", "base_time": datetime(2024, 1, 1), "number": [0, 5]},
        )
        AnemoiInputSource().compile(inputs={}, block=block)
        assert get_initial_conditions.call_args.kwargs["ensemble"] == [0, 5]


# ===================================================================
# AnemoiInputSource
# ===================================================================


class TestAnemoiInputSourceValidate:
    def test_valid_config(self, anemoi_input_source_configuration: BlockInstance) -> None:
        output = AnemoiInputSource().validate(block=anemoi_input_source_configuration, inputs={}, restrictions={})
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None

    def test_output_has_param_axis(self, anemoi_input_source_output: QubedOutput) -> None:
        assert contains(anemoi_input_source_output, "param")

    @pytest.mark.parametrize("members", [[0], [5], [1, 2, 3], [1]])
    def test_ensemble_model_member_lists(self, ensemble_model: None, dummy_checkpoint: CompositeArtifactId, members: list[int]) -> None:
        block = _make_block(
            AnemoiInputSource,
            {"checkpoint": dummy_checkpoint, "input_source": "opendata", "base_time": datetime(2024, 1, 1), "number": members},
        )
        output = AnemoiInputSource().validate(block=block, inputs={}, restrictions={})
        assert set(axes(output)["number"]) == set(members)  # type: ignore[arg-type]

    def test_ensemble_model_without_members_runs_control_member(
        self, ensemble_model: None, anemoi_input_source_configuration: BlockInstance
    ) -> None:
        output = AnemoiInputSource().validate(block=anemoi_input_source_configuration, inputs={}, restrictions={})
        assert axes(output)["number"] == {0}  # type: ignore[arg-type]

    @pytest.mark.parametrize("members", [[0], [1], [2], [1, 2], [0, 1]])
    def test_non_ensemble_model_rejects_any_members(
        self, non_ensemble_model: None, dummy_checkpoint: CompositeArtifactId, members: list[int]
    ) -> None:
        block = _make_block(
            AnemoiInputSource,
            {"checkpoint": dummy_checkpoint, "input_source": "opendata", "base_time": datetime(2024, 1, 1), "number": members},
        )
        with pytest.raises(ValueError, match="ensemble members cannot be set"):
            AnemoiInputSource().validate(block=block, inputs={}, restrictions={})

    @pytest.mark.parametrize("model", ["non_ensemble_model", "unknown_model"])
    def test_deterministic_model_has_dates_but_no_number_axis(
        self, request: pytest.FixtureRequest, model: str, anemoi_input_source_configuration: BlockInstance
    ) -> None:
        request.getfixturevalue(model)
        output = AnemoiInputSource().validate(block=anemoi_input_source_configuration, inputs={}, restrictions={})
        assert not contains(output, "number")  # type: ignore[arg-type]
        assert axes(output)["date"] == {"20240101"}  # type: ignore[arg-type]
        assert axes(output)["time"] == {"0000"}  # type: ignore[arg-type]

    @pytest.mark.parametrize("members", [[0], [1], [1, 2], [0, 1]])
    def test_unknown_model_rejects_any_members(
        self, unknown_model: None, dummy_checkpoint: CompositeArtifactId, members: list[int]
    ) -> None:
        block = _make_block(
            AnemoiInputSource,
            {"checkpoint": dummy_checkpoint, "input_source": "opendata", "base_time": datetime(2024, 1, 1), "number": members},
        )
        with pytest.raises(ValueError, match="ensemble members cannot be set"):
            AnemoiInputSource().validate(block=block, inputs={}, restrictions={})

    @pytest.mark.parametrize("model", ["non_ensemble_model", "unknown_model"])
    def test_deterministic_model_restricts_members_to_none(
        self, request: pytest.FixtureRequest, model: str, anemoi_input_source_configuration: BlockInstance
    ) -> None:
        request.getfixturevalue(model)
        restrictions: dict = {}
        AnemoiInputSource().validate(block=anemoi_input_source_configuration, inputs={}, restrictions=restrictions)
        assert set(restrictions) == {"number"}
        assert restrictions["number"].serialize() == "enumClosed[str]('none')"

    def test_ensemble_model_restricts_members_to_the_option_type(
        self, ensemble_model: None, anemoi_input_source_configuration: BlockInstance
    ) -> None:
        restrictions: dict = {}
        AnemoiInputSource().validate(block=anemoi_input_source_configuration, inputs={}, restrictions=restrictions)
        assert restrictions == {"number": ENSEMBLE_MEMBERS_TYPE}

    def test_output_has_no_step_axis(self, anemoi_input_source_output: QubedOutput) -> None:
        """Input source returns initial conditions - no step dimension."""
        assert not contains(anemoi_input_source_output, "step")


class TestAnemoiInputSourceIntersect:
    """Sources always reject intersection - they are roots."""

    def test_rejects_qubed_output(self, anemoi_input_source_output: QubedOutput) -> None:
        assert not AnemoiInputSource().intersect(other=anemoi_input_source_output)  # type: ignore[arg-type]

    def test_rejects_empty_qubed_output(self) -> None:
        assert not AnemoiInputSource().intersect(other=QubedOutput())  # type: ignore[arg-type]


# ===================================================================
# AnemoiTransform
# ===================================================================


class TestAnemoiTransformValidate:
    def test_valid_no_number_axis(self, anemoi_transform_configuration: BlockInstance, anemoi_input_source_output: QubedOutput) -> None:
        input_without_number = anemoi_input_source_output
        output = AnemoiTransform().validate(
            block=anemoi_transform_configuration,
            inputs={"initial conditions": input_without_number},
            restrictions={},
        )
        assert isinstance(output, QubedOutput)
        assert not contains(input_without_number, "number")
        assert not contains(output, "number")

    def test_valid_propagates_number_axis(
        self, ensemble_model: None, anemoi_transform_configuration: BlockInstance, anemoi_input_source_output: QubedOutput
    ) -> None:
        input_with_number = _with_members(anemoi_input_source_output, [3])
        output = AnemoiTransform().validate(
            block=anemoi_transform_configuration,
            inputs={"initial conditions": input_with_number},
            restrictions={},
        )
        assert isinstance(output, QubedOutput)
        assert contains(output, "number")
        assert set(axes(output)["number"]) == {3}

    def test_propagates_number_list(
        self, ensemble_model: None, anemoi_transform_configuration: BlockInstance, anemoi_input_source_output: QubedOutput
    ) -> None:
        input_with_number = _with_members(anemoi_input_source_output, [1, 2, 3])
        output = AnemoiTransform().validate(
            block=anemoi_transform_configuration,
            inputs={"initial conditions": input_with_number},
            restrictions={},
        )
        assert axes(output)["number"] == {1, 2, 3}  # type: ignore[arg-type]

    @pytest.mark.parametrize("model", ["ensemble_model", "non_ensemble_model", "unknown_model"])
    @pytest.mark.parametrize("members", [[0], [3], [0, 3], [2, 3]])
    def test_preserves_upstream_members_for_every_model_type(
        self,
        request: pytest.FixtureRequest,
        model: str,
        members: list[int],
        anemoi_transform_configuration: BlockInstance,
        anemoi_input_source_output: QubedOutput,
    ) -> None:
        """The model runs on every supplied member whatever its type, so the output `number` axis is the upstream one"""
        request.getfixturevalue(model)
        output = AnemoiTransform().validate(
            block=anemoi_transform_configuration,
            inputs={"initial conditions": _with_members(anemoi_input_source_output, members)},
            restrictions={},
        )
        assert axes(output)["number"] == set(members)  # type: ignore[arg-type]

    @pytest.mark.parametrize("model", ["ensemble_model", "non_ensemble_model", "unknown_model"])
    def test_no_number_axis_without_upstream_members(
        self,
        request: pytest.FixtureRequest,
        model: str,
        anemoi_transform_configuration: BlockInstance,
        anemoi_input_source_output: QubedOutput,
    ) -> None:
        request.getfixturevalue(model)
        upstream = (
            collapse(anemoi_input_source_output, "number") if contains(anemoi_input_source_output, "number") else anemoi_input_source_output
        )  # type: ignore[arg-type]
        output = AnemoiTransform().validate(
            block=anemoi_transform_configuration,
            inputs={"initial conditions": upstream},
            restrictions={},
        )
        assert not contains(output, "number")  # type: ignore[arg-type]

    @pytest.mark.parametrize("model", ["ensemble_model", "non_ensemble_model", "unknown_model"])
    def test_restricts_only_lead_time(
        self,
        request: pytest.FixtureRequest,
        model: str,
        anemoi_transform_configuration: BlockInstance,
        anemoi_input_source_output: QubedOutput,
    ) -> None:
        """The transform has no `number` option (members come from upstream), so it is never restricted"""
        request.getfixturevalue(model)
        restrictions: dict = {}
        AnemoiTransform().validate(
            block=anemoi_transform_configuration, inputs={"initial conditions": anemoi_input_source_output}, restrictions=restrictions
        )
        assert set(restrictions) == {"lead_time"}

    def test_output_has_step_axis(self, anemoi_transform_configuration: BlockInstance, anemoi_input_source_output: QubedOutput) -> None:
        output: QubedOutput = AnemoiTransform().validate(
            block=anemoi_transform_configuration,
            inputs={"initial conditions": anemoi_input_source_output},
            restrictions={},
        )  # type: ignore[assignment]
        assert contains(output, "step")

    def test_output_has_param_axis(self, anemoi_transform_configuration: BlockInstance, anemoi_input_source_output: QubedOutput) -> None:
        output: QubedOutput = AnemoiTransform().validate(
            block=anemoi_transform_configuration,
            inputs={"initial conditions": anemoi_input_source_output},
            restrictions={},
        )  # type: ignore[assignment]
        assert contains(output, "param")

    def test_output_has_basetime(self, anemoi_transform_configuration: BlockInstance, anemoi_input_source_output: QubedOutput) -> None:
        output: QubedOutput = AnemoiTransform().validate(
            block=anemoi_transform_configuration,
            inputs={"initial conditions": anemoi_input_source_output},
            restrictions={},
        )  # type: ignore[assignment]
        assert set(axes(output)["date"]) == {"20240101"}

    def test_invalid_lead_time_not_a_digit(self, dummy_checkpoint: CompositeArtifactId, anemoi_input_source_output: QubedOutput) -> None:
        block = _make_raw_block(
            AnemoiTransform,
            {"checkpoint": dummy_checkpoint, "lead_time": "abc"},
            input_ids={"initial conditions": "src"},
        )
        with pytest.raises(BlockInstanceConfigurationError, match="expected int"):
            AnemoiTransform().validate(
                block=block,
                inputs={"initial conditions": anemoi_input_source_output},
                restrictions={},
            )

    def test_invalid_lead_time_negative(self, dummy_checkpoint: CompositeArtifactId, anemoi_input_source_output: QubedOutput) -> None:
        block = _make_block(
            AnemoiTransform,
            {"checkpoint": dummy_checkpoint, "lead_time": -1},
            input_ids={"initial conditions": "src"},
        )
        with pytest.raises(Exception, match="must be greater than checkpoint timestep"):
            AnemoiTransform().validate(
                block=block,
                inputs={"initial conditions": anemoi_input_source_output},
                restrictions={},
            )

    def test_invalid_lead_time_not_a_timestep_multiple(
        self, six_hour_dummy_checkpoint: CompositeArtifactId, anemoi_input_source_output: QubedOutput
    ) -> None:
        block = _make_block(
            AnemoiTransform,
            {"checkpoint": six_hour_dummy_checkpoint, "lead_time": 7},
            input_ids={"initial conditions": "src"},
        )
        with pytest.raises(Exception, match="must be a multiple of checkpoint timestep"):
            AnemoiTransform().validate(block=block, inputs={"initial conditions": anemoi_input_source_output}, restrictions={})

    def test_unknown_checkpoint(self, registered_provider: None, anemoi_input_source_output: QubedOutput) -> None:
        block = _make_block(
            AnemoiTransform,
            {"checkpoint": CompositeArtifactId.from_str("dummy_store:unknown"), "lead_time": 24},
            input_ids={"initial conditions": "src"},
        )
        with pytest.raises(Exception):
            AnemoiTransform().validate(block=block, inputs={"initial conditions": anemoi_input_source_output}, restrictions={})

    def test_incompatible_input_dataset(self, dummy_checkpoint: CompositeArtifactId) -> None:
        """If the input dataset does not contain the model's required input params, validate should error."""
        incompatible = QubedOutput(dataqube=Qube.from_datacube({"param": ["nonexistent"]}))
        block = _make_block(
            AnemoiTransform,
            {"checkpoint": dummy_checkpoint, "lead_time": 24},
            input_ids={"initial conditions": "src"},
        )
        with pytest.raises(Exception, match="not compatible"):
            AnemoiTransform().validate(block=block, inputs={"initial conditions": incompatible}, restrictions={})


class TestAnemoiTransformIntersect:
    def test_accepts_output_with_param(self, anemoi_source_output: QubedOutput) -> None:
        assert AnemoiTransform().intersect(other=anemoi_source_output)  # type: ignore[arg-type]

    def test_rejects_output_without_param(self, anemoi_source_output: QubedOutput) -> None:
        no_param = collapse(anemoi_source_output, "param")
        assert not AnemoiTransform().intersect(other=no_param)  # type: ignore[arg-type]

    def test_rejects_empty_qubed_output(self) -> None:
        assert not AnemoiTransform().intersect(other=QubedOutput())  # type: ignore[arg-type]

    def test_rejects_non_qubed_output(self) -> None:
        assert not AnemoiTransform().intersect(other=MagicMock())  # type: ignore[arg-type]


class TestAnemoiTransformCompile:
    # TODO: the commented out tests are allowed by validate, but do not compile. Re-enable when issues are fixed.

    @pytest.mark.parametrize(
        "source_output, source_action",
        [
            # [lf("anemoi_source_output"), lf("anemoi_source_action")],
            # [lf("anemois_source_ensemble_output"), lf("anemois_source_ensemble_action")],
            [lf("anemoi_input_source_output"), lf("anemoi_input_source_action")],
        ],
    )
    def test_compile_from_source(
        self, anemoi_transform_configuration: BlockInstance, source_output: QubedOutput, source_action: fluent.Action
    ) -> None:
        qubed_output = AnemoiTransform().validate(
            block=anemoi_transform_configuration, inputs={"initial conditions": source_output}, restrictions={}
        )
        action = (
            AnemoiTransform().compile(inputs={BlockInstanceId("src"): source_action}, block=anemoi_transform_configuration).get_or_raise()
        )
        action_datacubes = nodetree.datacubes(action.nodes)
        for index, cube in enumerate(datacubes(qubed_output)):
            assert set(cube.keys()) == set(x for x in action_datacubes[index] if x != "dataset")
            assert all(cube[dim] == action_datacubes[index][dim] for dim in cube)

    # @pytest.mark.parametrize("source_output, source_action", [
    #         [lf("anemoi_input_source_output"), lf("anemoi_input_source_action")],
    # ])
    # def test_compile_from_transform(self, dummy_checkpoint: CompositeArtifactId, anemoi_transform_configuration: BlockInstance, source_output: QubedOutput, source_action: fluent.Action) -> None:
    #     first_output = AnemoiTransform().validate(block=anemoi_transform_configuration, inputs={"initial conditions": source_output}, restrictions={})
    #     first_action = AnemoiTransform().compile(inputs={"src": source_action}, block=anemoi_transform_configuration).get_or_raise()
    #     second_config = _make_block(
    #         AnemoiTransform,
    #         {"checkpoint": dummy_checkpoint, "lead_time": 48},
    #         input_ids={"initial conditions": "first_transform"},
    #     )
    #     second_output: QubedOutput = AnemoiTransform().validate(
    #         block=second_config,
    #         inputs={"initial conditions": first_output},
    #         restrictions={},
    #     )
    #     second_action = AnemoiTransform().compile(inputs={"first_transform": first_action}, block=second_config).get_or_raise()
    #     action_datacubes = nodetree.datacubes(second_action.nodes)
    #     for index, cube in enumerate(datacubes(second_output)):
    #         assert set(cube.keys()) == set(x for x in action_datacubes[index] if x not in ["dataset"])
    #         assert all(cube[dim] == action_datacubes[index][dim] for dim in cube)


# ===================================================================
# Flows - stacking blocks together
# ===================================================================


class TestFlowAnemoiSourceToTransform:
    """AnemoiSource → AnemoiTransform (chained inference)."""

    @pytest.mark.parametrize("model", ["non_ensemble_model", "unknown_model"])
    def test_deterministic_source_feeds_transform(
        self,
        request: pytest.FixtureRequest,
        model: str,
        anemoi_source_configuration: BlockInstance,
        anemoi_transform_configuration: BlockInstance,
    ) -> None:
        """Regression: non-ensemble and unknown sources lacked date/time axes, so the transform failed with an IndexError"""
        request.getfixturevalue(model)
        source_output = AnemoiSource().validate(block=anemoi_source_configuration, inputs={}, restrictions={})
        assert not contains(source_output, "number")  # type: ignore[arg-type]
        output: QubedOutput = AnemoiTransform().validate(
            block=anemoi_transform_configuration,
            inputs={"initial conditions": source_output},  # type: ignore[dict-item]
            restrictions={},
        )  # type: ignore[assignment]
        assert not contains(output, "number")
        assert axes(output)["date"] == {"20240101"}
        assert axes(output)["time"] == {"0000"}
        assert contains(output, "param")
        assert contains(output, "step")

    @pytest.mark.parametrize("model", ["non_ensemble_model", "unknown_model"])
    def test_deterministic_input_source_feeds_transform(
        self,
        request: pytest.FixtureRequest,
        model: str,
        anemoi_input_source_configuration: BlockInstance,
        anemoi_transform_configuration: BlockInstance,
    ) -> None:
        request.getfixturevalue(model)
        source_output = AnemoiInputSource().validate(block=anemoi_input_source_configuration, inputs={}, restrictions={})
        output: QubedOutput = AnemoiTransform().validate(
            block=anemoi_transform_configuration,
            inputs={"initial conditions": source_output},  # type: ignore[dict-item]
            restrictions={},
        )  # type: ignore[assignment]
        assert not contains(output, "number")
        assert axes(output)["date"] == {"20240101"}

    def test_upstream_without_dates_is_accepted(
        self, anemoi_transform_configuration: BlockInstance, anemoi_input_source_output: QubedOutput
    ) -> None:
        """An upstream with neither `number` nor date/time axes validates, with no base time on the output"""
        upstream = collapse(anemoi_input_source_output, ["date", "time"])
        output = AnemoiTransform().validate(block=anemoi_transform_configuration, inputs={"initial conditions": upstream}, restrictions={})
        assert contains(output, "step")  # type: ignore[arg-type]
        assert not contains(output, "date")  # type: ignore[arg-type]

    def test_source_output_feeds_transform(
        self,
        anemoi_source_output: QubedOutput,
        anemoi_transform_configuration: BlockInstance,
    ) -> None:
        """The deterministic source output should be a valid input for the transform."""
        output = AnemoiTransform().validate(
            block=anemoi_transform_configuration,
            inputs={"initial conditions": anemoi_source_output},
            restrictions={},
        )
        assert isinstance(output, QubedOutput)
        assert contains(output, "param")
        assert contains(output, "step")

    def test_ensemble_source_propagates_number_through_transform(
        self,
        anemoi_source_ensemble_output: QubedOutput,
        anemoi_transform_configuration: BlockInstance,
    ) -> None:
        output: QubedOutput = AnemoiTransform().validate(
            block=anemoi_transform_configuration,
            inputs={"initial conditions": anemoi_source_ensemble_output},
            restrictions={},
        )  # type: ignore[assignment]
        assert contains(output, "number")
        assert set(axes(output)["number"]) == {3}


class TestFlowAnemoiInputSourceToTransform:
    """AnemoiInputSource → AnemoiTransform (initial conditions → inference)."""

    def test_input_source_feeds_transform(
        self,
        anemoi_input_source_output: QubedOutput,
        anemoi_transform_configuration: BlockInstance,
    ) -> None:
        output = AnemoiTransform().validate(
            block=anemoi_transform_configuration,
            inputs={"initial conditions": anemoi_input_source_output},
            restrictions={},
        )
        assert isinstance(output, QubedOutput)
        assert contains(output, "param")
        assert contains(output, "step")
        assert not contains(output, "number")  # type: ignore[arg-type]

    def test_ensemble_input_source_feeds_transform(
        self,
        ensemble_model: None,
        anemoi_input_source_output: QubedOutput,
        anemoi_transform_configuration: BlockInstance,
    ) -> None:
        output = AnemoiTransform().validate(
            block=anemoi_transform_configuration,
            inputs={"initial conditions": anemoi_input_source_output},
            restrictions={},
        )
        assert axes(output)["number"] == {0}  # type: ignore[arg-type]


class TestFlowTransformMembersMatchCompile:
    """Regression: the `number` axis advertised by a transform is the one its compiled action has.

    The upstream members are kept by earthkit-workflows-anemoi whatever the model type, so validate must keep them too.
    """

    @pytest.mark.parametrize("model", ["ensemble_model", "non_ensemble_model", "unknown_model"])
    @pytest.mark.parametrize("members", [[0], [0, 3]])
    def test_validate_matches_compile(
        self,
        request: pytest.FixtureRequest,
        monkeypatch: pytest.MonkeyPatch,
        dummy_checkpoint: CompositeArtifactId,
        anemoi_transform_configuration: BlockInstance,
        model: str,
        members: list[int],
    ) -> None:
        # the upstream carries members, as only an ensemble model produces them
        _set_ensemble_model(monkeypatch, True)
        source_block = _make_block(
            AnemoiInputSource,
            {"checkpoint": dummy_checkpoint, "input_source": "opendata", "base_time": datetime(2024, 1, 1), "number": members},
        )
        source_output: QubedOutput = AnemoiInputSource().validate(block=source_block, inputs={}, restrictions={})  # type: ignore[assignment]
        source_action = AnemoiInputSource().compile(inputs={}, block=source_block).get_or_raise()
        assert axes(source_output)["number"] == set(members)

        # the transform is then validated and compiled for the model type under test
        request.getfixturevalue(model)
        output: QubedOutput = AnemoiTransform().validate(
            block=anemoi_transform_configuration, inputs={"initial conditions": source_output}, restrictions={}
        )  # type: ignore[assignment]
        action = (
            AnemoiTransform().compile(inputs={BlockInstanceId("src"): source_action}, block=anemoi_transform_configuration).get_or_raise()  # type: ignore[arg-type]
        )

        assert axes(output)["number"] == set(members)
        action_datacubes = nodetree.datacubes(action.nodes)
        assert action_datacubes
        for index, cube in enumerate(datacubes(output)):
            assert set(cube.keys()) == set(x for x in action_datacubes[index] if x != "dataset")
            assert all(cube[dim] == action_datacubes[index][dim] for dim in cube)

    @pytest.mark.parametrize("model", ["non_ensemble_model", "unknown_model"])
    def test_validate_matches_compile_without_members(
        self,
        request: pytest.FixtureRequest,
        anemoi_transform_configuration: BlockInstance,
        anemoi_input_source_configuration: BlockInstance,
        model: str,
    ) -> None:
        """A deterministic upstream has no `number` axis: advertised has none, the compiled action has none"""
        request.getfixturevalue(model)
        source_output: QubedOutput = AnemoiInputSource().validate(block=anemoi_input_source_configuration, inputs={}, restrictions={})  # type: ignore[assignment]
        source_action = AnemoiInputSource().compile(inputs={}, block=anemoi_input_source_configuration).get_or_raise()
        output: QubedOutput = AnemoiTransform().validate(
            block=anemoi_transform_configuration, inputs={"initial conditions": source_output}, restrictions={}
        )  # type: ignore[assignment]
        action = (
            AnemoiTransform().compile(inputs={BlockInstanceId("src"): source_action}, block=anemoi_transform_configuration).get_or_raise()  # type: ignore[arg-type]
        )

        assert not contains(output, "number")
        action_datacubes = nodetree.datacubes(action.nodes)
        for index, cube in enumerate(datacubes(output)):
            assert set(cube.keys()) == set(x for x in action_datacubes[index] if x != "dataset")


class TestFlowChainedTransforms:
    """AnemoiInputSource → AnemoiTransform → AnemoiTransform (two inference steps)."""

    def test_chained_transforms(
        self,
        dummy_checkpoint: CompositeArtifactId,
        anemoi_input_source_output: QubedOutput,
        anemoi_transform_configuration: BlockInstance,
    ) -> None:
        first_output: QubedOutput = AnemoiTransform().validate(
            block=anemoi_transform_configuration,
            inputs={"initial conditions": anemoi_input_source_output},
            restrictions={},
        )  # type: ignore[assignment]

        second_config = _make_block(
            AnemoiTransform,
            {"checkpoint": dummy_checkpoint, "lead_time": 48},
            input_ids={"initial conditions": "first_transform"},
        )
        second_output: QubedOutput = AnemoiTransform().validate(
            block=second_config,
            inputs={"initial conditions": first_output},
            restrictions={},
        )  # type: ignore[assignment]

        assert isinstance(second_output, QubedOutput)
        assert contains(second_output, "param")
        assert contains(second_output, "step")

    def test_chained_transforms_propagate_ensemble(
        self,
        ensemble_model: None,
        dummy_checkpoint: CompositeArtifactId,
        anemoi_input_source_output: QubedOutput,
        anemoi_transform_configuration: BlockInstance,
    ) -> None:
        input_with_number = _with_members(anemoi_input_source_output, [1, 2])

        first_output: QubedOutput = AnemoiTransform().validate(
            block=anemoi_transform_configuration,
            inputs={"initial conditions": input_with_number},
            restrictions={},
        )  # type: ignore[assignment]
        assert contains(first_output, "number")

        second_config = _make_block(
            AnemoiTransform,
            {"checkpoint": dummy_checkpoint, "lead_time": 48},
            input_ids={"initial conditions": "first_transform"},
        )
        second_output: QubedOutput = AnemoiTransform().validate(
            block=second_config,
            inputs={"initial conditions": first_output},
            restrictions={},
        )  # type: ignore[assignment]

        assert contains(second_output, "number")
        assert set(axes(second_output)["number"]) == {1, 2}


# ===================================================================
# Plugin-level integration
# ===================================================================


class TestAnemoiCatalogueIntegration:
    """Verify catalogue / enum types at the plugin registration level."""

    def test_checkpoint_enum_type_matches_registered_provider(self, registered_provider: None) -> None:
        assert get_checkpoint_enum_type().serialize() == "enumClosed[artifact]('dummy_store:dummy_ckpt')"

    def test_checkpoint_enum_type_rejects_unknown_checkpoint(self, registered_provider: None) -> None:
        with pytest.raises(WrongType, match="not known to the ArtifactsProvider"):
            get_checkpoint_enum_type().validate_convert("dummy_store:unknown")

    def test_checkpoint_enum_type_rejects_malformed_id(self, registered_provider: None) -> None:
        with pytest.raises(WrongType, match="must be of the form"):
            get_checkpoint_enum_type().validate_convert("not-a-valid-id")

    def test_plugin_expander_includes_anemoi_transform(self, anemoi_source_output: QubedOutput) -> None:
        """AnemoiTransform should appear in expansions for a QubedOutput that has 'param'."""
        expansions = plugin().expander(anemoi_source_output)
        factory_ids = {e.factory for e in expansions}
        assert BlockFactoryId("anemoiTransform") in factory_ids

    def test_plugin_expander_excludes_anemoi_transform_for_no_param(self) -> None:
        """AnemoiTransform should NOT appear when the output has no 'param' axis."""
        output = QubedOutput(dataqube=Qube.from_datacube({"step": [0, 6, 12]}))
        expansions = plugin().expander(output)
        factory_ids = {e.factory for e in expansions}
        assert BlockFactoryId("anemoiTransform") not in factory_ids

    def test_plugin_expander_excludes_sources_from_expansion(self, anemoi_source_output: QubedOutput) -> None:
        """Source blocks should never appear as expansions (they are roots)."""
        expansions = plugin().expander(anemoi_source_output)
        factory_ids = {e.factory for e in expansions}
        assert BlockFactoryId("anemoiSource") not in factory_ids
        assert BlockFactoryId("anemoiInputSource") not in factory_ids

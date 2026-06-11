# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the preset instantiation service.

All external collaborators (DB, blueprint service, run service) are mocked so
these tests run without a database or gateway.  The three difficulty tiers
(beginner, intermediate, advanced) and the ``auto_run`` flag are covered, as
well as the main error paths.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from cascade.low.func import Either

import forecastbox.domain.preset.service as preset_service
from forecastbox.domain.blueprint.service import (
    BlueprintBuilder,
    BlueprintSaveResult,
    BlueprintValidationExpansion,
)
from forecastbox.domain.blueprint.types import BlueprintId
from forecastbox.domain.preset.exceptions import PresetInstantiationValidationError, PresetNotFound
from forecastbox.domain.preset.service import InstantiateResult, instantiate_preset
from forecastbox.domain.preset.types import PresetId
from forecastbox.domain.run.service import ExecuteResult
from forecastbox.domain.run.types import RunId
from forecastbox.utility.auth import AuthContext

# ---------------------------------------------------------------------------
# Shared test fixtures and helpers
# ---------------------------------------------------------------------------

_AUTH = AuthContext(user_id="test-user", is_admin=False)

_BLUEPRINT_ID = BlueprintId("bp-001")
_BLUEPRINT_VERSION = 1
_RUN_ID = RunId("run-001")
_ATTEMPT_COUNT = 1

# A minimal valid builder template dict (no blocks, no glyphs).
_EMPTY_BUILDER_DICT: dict[str, Any] = {
    "blocks": {},
    "environment": None,
    "local_glyphs": {},
}

# A clean validation result with no errors.
_CLEAN_VALIDATION = BlueprintValidationExpansion(
    global_errors=[],
    block_errors={},
    possible_sources=[],
    possible_expansions={},
)

# A successful save result.
_SAVE_RESULT = BlueprintSaveResult(
    blueprint_id=_BLUEPRINT_ID,
    blueprint_version=_BLUEPRINT_VERSION,
)

# A successful execute result wrapped in Either.ok.
_EXECUTE_RESULT = Either.ok(ExecuteResult(run_id=_RUN_ID, attempt_count=_ATTEMPT_COUNT))


def _make_db_row(
    *,
    difficulty: str = "beginner",
    parameters: list[dict] | None = None,
    local_glyphs: dict[str, str] | None = None,
    name: str = "Test Preset",
) -> SimpleNamespace:
    """Return a SimpleNamespace that mimics a HighLevelPreset SQLAlchemy row."""
    builder_template = dict(_EMPTY_BUILDER_DICT)
    if local_glyphs:
        builder_template = {**builder_template, "local_glyphs": local_glyphs}
    return SimpleNamespace(
        builder_template=builder_template,
        parameters=parameters or [],
        difficulty=difficulty,
        name=name,
    )


def _make_blueprint_orm_row(
    blueprint_id: BlueprintId = _BLUEPRINT_ID,
    version: int = _BLUEPRINT_VERSION,
) -> SimpleNamespace:
    """Return a SimpleNamespace that mimics a Blueprint SQLAlchemy row."""
    return SimpleNamespace(
        blueprint_id=blueprint_id,
        version=version,
        builder=_EMPTY_BUILDER_DICT,
    )


# ---------------------------------------------------------------------------
# Helper: build a stack of patches for the three external collaborators.
# ---------------------------------------------------------------------------


_UNSET = object()
"""Sentinel used to distinguish 'not provided' from an explicit ``None`` value."""


def _patch_collaborators(
    *,
    db_row: Any,
    validation: BlueprintValidationExpansion = _CLEAN_VALIDATION,
    save_result: BlueprintSaveResult = _SAVE_RESULT,
    blueprint_orm: Any = _UNSET,
    execute_result: Any = _EXECUTE_RESULT,
) -> tuple[Any, ...]:
    """Return a tuple of patch context managers for the service's collaborators.

    Usage::

        patches = _patch_collaborators(db_row=row)
        with patches[0], patches[1], patches[2], patches[3]:
            ...

    Pass ``blueprint_orm=None`` to simulate the blueprint not being found after
    saving (``get_blueprint_for_execution`` returns ``None``).
    """
    if blueprint_orm is _UNSET:
        blueprint_orm = _make_blueprint_orm_row()

    p_get_preset = patch(
        "forecastbox.domain.preset.service.preset_db.get_preset",
        new=AsyncMock(return_value=db_row),
    )
    p_validate = patch(
        "forecastbox.domain.preset.service.validate_expand",
        new=AsyncMock(return_value=validation),
    )
    p_save = patch(
        "forecastbox.domain.preset.service.save_builder",
        new=AsyncMock(return_value=save_result),
    )
    p_get_bp = patch(
        "forecastbox.domain.preset.service.run_service.get_blueprint_for_execution",
        new=AsyncMock(return_value=blueprint_orm),
    )
    p_execute = patch(
        "forecastbox.domain.preset.service.run_service.execute",
        new=AsyncMock(return_value=execute_result),
    )
    return p_get_preset, p_validate, p_save, p_get_bp, p_execute


# ===========================================================================
# Tests: beginner difficulty
# ===========================================================================


@pytest.mark.asyncio
async def test_beginner_preset_creates_blueprint_and_submits_run() -> None:
    """Beginner preset: blueprint is saved and a run is submitted."""
    db_row = _make_db_row(difficulty="beginner")
    p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(db_row=db_row)

    with p_get, p_val, p_save, p_get_bp, p_exec:
        result = await instantiate_preset(
            preset_id=PresetId("preset-beginner"),
            parameter_values={},
            auth_context=_AUTH,
        )

    assert isinstance(result, InstantiateResult)
    assert result.blueprint_id == _BLUEPRINT_ID
    assert result.blueprint_version == _BLUEPRINT_VERSION
    assert result.run_id == _RUN_ID
    assert result.attempt_count == _ATTEMPT_COUNT
    assert isinstance(result.builder, BlueprintBuilder)


@pytest.mark.asyncio
async def test_beginner_preset_calls_save_builder_with_materialised_builder() -> None:
    """save_builder receives the materialised builder (not the raw template)."""
    db_row = _make_db_row(difficulty="beginner")
    p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(db_row=db_row)

    with p_get, p_val, p_save as mock_save, p_get_bp, p_exec:
        await instantiate_preset(
            preset_id=PresetId("preset-beginner"),
            parameter_values={},
            auth_context=_AUTH,
        )

    mock_save.assert_awaited_once()
    call_kwargs = mock_save.call_args
    # save_builder is called with keyword args: auth_context and payload
    payload = call_kwargs.kwargs["payload"]
    assert isinstance(payload.builder, BlueprintBuilder)


@pytest.mark.asyncio
async def test_beginner_preset_calls_run_execute() -> None:
    """run_service.execute is called exactly once for a beginner preset."""
    db_row = _make_db_row(difficulty="beginner")
    p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(db_row=db_row)

    with p_get, p_val, p_save, p_get_bp, p_exec as mock_exec:
        await instantiate_preset(
            preset_id=PresetId("preset-beginner"),
            parameter_values={},
            auth_context=_AUTH,
        )

    mock_exec.assert_awaited_once()


# ===========================================================================
# Tests: intermediate difficulty
# ===========================================================================


@pytest.mark.asyncio
async def test_intermediate_preset_injects_glyphs_into_local_glyphs() -> None:
    """Intermediate preset: parameter values are written into builder.local_glyphs."""
    parameters = [
        {
            "glyph_key": "date",
            "label": "Date",
            "description": "Forecast date",
            "value_type": "string",
            "default_value": "20240101",
        },
        {
            "glyph_key": "resolution",
            "label": "Resolution",
            "description": "Grid resolution",
            "value_type": "string",
            "default_value": "o96",
        },
    ]
    db_row = _make_db_row(difficulty="intermediate", parameters=parameters)
    p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(db_row=db_row)

    with p_get, p_val, p_save, p_get_bp, p_exec:
        result = await instantiate_preset(
            preset_id=PresetId("preset-intermediate"),
            parameter_values={"date": "20250601", "resolution": "n320"},
            auth_context=_AUTH,
        )

    assert result.builder.local_glyphs["date"] == "20250601"
    assert result.builder.local_glyphs["resolution"] == "n320"


@pytest.mark.asyncio
async def test_intermediate_preset_blueprint_and_run_are_populated() -> None:
    """Intermediate preset: blueprint_id and run_id are both set in the result."""
    db_row = _make_db_row(difficulty="intermediate")
    p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(db_row=db_row)

    with p_get, p_val, p_save, p_get_bp, p_exec:
        result = await instantiate_preset(
            preset_id=PresetId("preset-intermediate"),
            parameter_values={},
            auth_context=_AUTH,
        )

    assert result.blueprint_id is not None
    assert result.run_id is not None


# ===========================================================================
# Tests: advanced difficulty (default auto_run=True)
# ===========================================================================


@pytest.mark.asyncio
async def test_advanced_preset_with_default_auto_run_creates_blueprint_and_run() -> None:
    """Advanced preset with default auto_run=True: blueprint is saved and run is submitted.

    The service no longer branches on difficulty — auto_run controls the behaviour.
    """
    db_row = _make_db_row(difficulty="advanced")
    p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(db_row=db_row)

    with p_get, p_val, p_save as mock_save, p_get_bp, p_exec as mock_exec:
        result = await instantiate_preset(
            preset_id=PresetId("preset-advanced"),
            parameter_values={},
            auth_context=_AUTH,
            # auto_run defaults to True
        )

    mock_save.assert_awaited_once()
    mock_exec.assert_awaited_once()

    assert result.blueprint_id == _BLUEPRINT_ID
    assert result.run_id == _RUN_ID
    assert isinstance(result.builder, BlueprintBuilder)


@pytest.mark.asyncio
async def test_advanced_preset_still_validates_builder() -> None:
    """Advanced preset: validate_expand is still called (validation is always performed)."""
    db_row = _make_db_row(difficulty="advanced")
    p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(db_row=db_row)

    with p_get, p_val as mock_val, p_save, p_get_bp, p_exec:
        await instantiate_preset(
            preset_id=PresetId("preset-advanced"),
            parameter_values={},
            auth_context=_AUTH,
        )

    mock_val.assert_awaited_once()


# ===========================================================================
# Tests: auto_run flag
# ===========================================================================


@pytest.mark.asyncio
async def test_auto_run_false_saves_blueprint_but_does_not_submit_run() -> None:
    """auto_run=False: blueprint is saved but no run is submitted for any difficulty."""
    for difficulty in ("beginner", "intermediate", "advanced"):
        db_row = _make_db_row(difficulty=difficulty)
        p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(db_row=db_row)

        with p_get, p_val, p_save as mock_save, p_get_bp, p_exec as mock_exec:
            result = await instantiate_preset(
                preset_id=PresetId(f"preset-{difficulty}"),
                parameter_values={},
                auth_context=_AUTH,
                auto_run=False,
            )

        mock_save.assert_awaited_once()
        mock_exec.assert_not_awaited()

        assert result.blueprint_id == _BLUEPRINT_ID
        assert result.blueprint_version == _BLUEPRINT_VERSION
        assert result.run_id is None
        assert result.attempt_count is None
        assert isinstance(result.builder, BlueprintBuilder)


@pytest.mark.asyncio
async def test_auto_run_true_saves_blueprint_and_submits_run() -> None:
    """auto_run=True (explicit): blueprint is saved and run is submitted."""
    db_row = _make_db_row(difficulty="intermediate")
    p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(db_row=db_row)

    with p_get, p_val, p_save as mock_save, p_get_bp, p_exec as mock_exec:
        result = await instantiate_preset(
            preset_id=PresetId("preset-intermediate"),
            parameter_values={},
            auth_context=_AUTH,
            auto_run=True,
        )

    mock_save.assert_awaited_once()
    mock_exec.assert_awaited_once()

    assert result.blueprint_id == _BLUEPRINT_ID
    assert result.run_id == _RUN_ID


@pytest.mark.asyncio
async def test_auto_run_false_blueprint_id_and_version_are_populated() -> None:
    """auto_run=False: blueprint_id and blueprint_version are set in the result."""
    db_row = _make_db_row(difficulty="advanced")
    p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(db_row=db_row)

    with p_get, p_val, p_save, p_get_bp, p_exec:
        result = await instantiate_preset(
            preset_id=PresetId("preset-advanced"),
            parameter_values={},
            auth_context=_AUTH,
            auto_run=False,
        )

    assert result.blueprint_id == _BLUEPRINT_ID
    assert result.blueprint_version == _BLUEPRINT_VERSION
    assert result.run_id is None
    assert result.attempt_count is None


# ===========================================================================
# Tests: parameter default fallback
# ===========================================================================


@pytest.mark.asyncio
async def test_missing_parameter_falls_back_to_default_value() -> None:
    """When a parameter key is absent from parameter_values, its default is used."""
    parameters = [
        {
            "glyph_key": "steps",
            "label": "Steps",
            "description": "Number of forecast steps",
            "value_type": "integer",
            "default_value": "10",
        }
    ]
    db_row = _make_db_row(difficulty="beginner", parameters=parameters)
    p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(db_row=db_row)

    # Caller provides no parameter_values at all.
    with p_get, p_val, p_save, p_get_bp, p_exec:
        result = await instantiate_preset(
            preset_id=PresetId("preset-defaults"),
            parameter_values={},
            auth_context=_AUTH,
        )

    assert result.builder.local_glyphs["steps"] == "10"


@pytest.mark.asyncio
async def test_caller_value_overrides_default() -> None:
    """When a parameter key IS present in parameter_values, it overrides the default."""
    parameters = [
        {
            "glyph_key": "steps",
            "label": "Steps",
            "description": "Number of forecast steps",
            "value_type": "integer",
            "default_value": "10",
        }
    ]
    db_row = _make_db_row(difficulty="beginner", parameters=parameters)
    p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(db_row=db_row)

    with p_get, p_val, p_save, p_get_bp, p_exec:
        result = await instantiate_preset(
            preset_id=PresetId("preset-override"),
            parameter_values={"steps": "42"},
            auth_context=_AUTH,
        )

    assert result.builder.local_glyphs["steps"] == "42"


@pytest.mark.asyncio
async def test_partial_parameter_values_mix_provided_and_defaults() -> None:
    """Provided keys use caller values; omitted keys fall back to defaults."""
    parameters = [
        {
            "glyph_key": "date",
            "label": "Date",
            "description": "Forecast date",
            "value_type": "string",
            "default_value": "20240101",
        },
        {
            "glyph_key": "steps",
            "label": "Steps",
            "description": "Forecast steps",
            "value_type": "integer",
            "default_value": "10",
        },
    ]
    db_row = _make_db_row(difficulty="beginner", parameters=parameters)
    p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(db_row=db_row)

    # Only provide 'date'; 'steps' should fall back to its default.
    with p_get, p_val, p_save, p_get_bp, p_exec:
        result = await instantiate_preset(
            preset_id=PresetId("preset-partial"),
            parameter_values={"date": "20250101"},
            auth_context=_AUTH,
        )

    assert result.builder.local_glyphs["date"] == "20250101"
    assert result.builder.local_glyphs["steps"] == "10"


# ===========================================================================
# Tests: error cases
# ===========================================================================


@pytest.mark.asyncio
async def test_invalid_preset_id_raises_preset_not_found() -> None:
    """When get_preset returns None, PresetNotFound is raised."""
    with patch(
        "forecastbox.domain.preset.service.preset_db.get_preset",
        new=AsyncMock(return_value=None),
    ):
        with pytest.raises(PresetNotFound):
            await instantiate_preset(
                preset_id=PresetId("does-not-exist"),
                parameter_values={},
                auth_context=_AUTH,
            )


@pytest.mark.asyncio
async def test_validation_errors_raise_preset_instantiation_validation_error() -> None:
    """When validate_expand returns errors, PresetInstantiationValidationError is raised."""
    bad_validation = BlueprintValidationExpansion(
        global_errors=["Missing required glyph 'date'"],
        block_errors={},
        possible_sources=[],
        possible_expansions={},
    )
    db_row = _make_db_row(difficulty="beginner")
    p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(
        db_row=db_row,
        validation=bad_validation,
    )

    with p_get, p_val, p_save, p_get_bp, p_exec:
        with pytest.raises(PresetInstantiationValidationError) as exc_info:
            await instantiate_preset(
                preset_id=PresetId("preset-bad"),
                parameter_values={},
                auth_context=_AUTH,
            )

    err = exc_info.value
    assert "Missing required glyph 'date'" in err.global_errors


@pytest.mark.asyncio
async def test_block_level_validation_errors_raise_preset_instantiation_validation_error() -> None:
    """Block-level errors in validate_expand also raise PresetInstantiationValidationError."""
    from fiab_core.fable import BlockInstanceId

    bad_validation = BlueprintValidationExpansion(
        global_errors=[],
        block_errors={BlockInstanceId("block-1"): ["Unknown factory"]},
        possible_sources=[],
        possible_expansions={},
    )
    db_row = _make_db_row(difficulty="beginner")
    p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(
        db_row=db_row,
        validation=bad_validation,
    )

    with p_get, p_val, p_save, p_get_bp, p_exec:
        with pytest.raises(PresetInstantiationValidationError) as exc_info:
            await instantiate_preset(
                preset_id=PresetId("preset-block-err"),
                parameter_values={},
                auth_context=_AUTH,
            )

    err = exc_info.value
    assert len(err.block_errors) == 1


@pytest.mark.asyncio
async def test_blueprint_not_found_after_save_raises_runtime_error() -> None:
    """If get_blueprint_for_execution returns None after saving, RuntimeError is raised."""
    db_row = _make_db_row(difficulty="beginner")
    p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(
        db_row=db_row,
        blueprint_orm=None,  # simulate blueprint not found
    )

    with p_get, p_val, p_save, p_get_bp, p_exec:
        with pytest.raises(RuntimeError, match="not found immediately after saving"):
            await instantiate_preset(
                preset_id=PresetId("preset-missing-bp"),
                parameter_values={},
                auth_context=_AUTH,
            )


@pytest.mark.asyncio
async def test_execute_failure_raises_runtime_error() -> None:
    """If run_service.execute returns an Either.error, RuntimeError is raised."""
    db_row = _make_db_row(difficulty="beginner")
    failed_execute = Either.error("gateway unavailable")
    p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(
        db_row=db_row,
        execute_result=failed_execute,
    )

    with p_get, p_val, p_save, p_get_bp, p_exec:
        with pytest.raises(RuntimeError, match="Failed to submit run"):
            await instantiate_preset(
                preset_id=PresetId("preset-exec-fail"),
                parameter_values={},
                auth_context=_AUTH,
            )


# ===========================================================================
# Tests: template immutability
# ===========================================================================


@pytest.mark.asyncio
async def test_builder_template_is_not_mutated() -> None:
    """The stored builder_template dict must not be modified by instantiation."""
    original_local_glyphs: dict[str, str] = {}
    parameters = [
        {
            "glyph_key": "date",
            "label": "Date",
            "description": "Forecast date",
            "value_type": "string",
            "default_value": "20240101",
        }
    ]
    builder_template_dict: dict[str, Any] = {
        "blocks": {},
        "environment": None,
        "local_glyphs": dict(original_local_glyphs),
    }
    db_row = SimpleNamespace(
        builder_template=builder_template_dict,
        parameters=parameters,
        difficulty="beginner",
        name="Immutability Test Preset",
    )
    p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(db_row=db_row)

    with p_get, p_val, p_save, p_get_bp, p_exec:
        await instantiate_preset(
            preset_id=PresetId("preset-immutable"),
            parameter_values={"date": "20250601"},
            auth_context=_AUTH,
        )

    # The original dict stored on the db_row must be unchanged.
    assert builder_template_dict["local_glyphs"] == original_local_glyphs


# ===========================================================================
# Tests: validate_expand is called with validate_only=True
# ===========================================================================


@pytest.mark.asyncio
async def test_validate_expand_called_with_validate_only_true() -> None:
    """The service always calls validate_expand with validate_only=True."""
    db_row = _make_db_row(difficulty="beginner")
    p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(db_row=db_row)

    with p_get, p_val as mock_val, p_save, p_get_bp, p_exec:
        await instantiate_preset(
            preset_id=PresetId("preset-validate-flag"),
            parameter_values={},
            auth_context=_AUTH,
        )

    _, call_kwargs = mock_val.call_args
    assert call_kwargs.get("validate_only") is True


# ===========================================================================
# Tests: auth_context is forwarded correctly
# ===========================================================================


@pytest.mark.asyncio
async def test_auth_context_forwarded_to_validate_expand() -> None:
    """The caller's AuthContext is passed through to validate_expand."""
    db_row = _make_db_row(difficulty="beginner")
    p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(db_row=db_row)
    custom_auth = AuthContext(user_id="alice", is_admin=True)

    with p_get, p_val as mock_val, p_save, p_get_bp, p_exec:
        await instantiate_preset(
            preset_id=PresetId("preset-auth"),
            parameter_values={},
            auth_context=custom_auth,
        )

    positional_args, _ = mock_val.call_args
    # validate_expand(builder, auth_context, validate_only=True)
    assert positional_args[1] == custom_auth


@pytest.mark.asyncio
async def test_auth_context_forwarded_to_save_builder() -> None:
    """The caller's AuthContext is passed through to save_builder."""
    db_row = _make_db_row(difficulty="beginner")
    p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(db_row=db_row)
    custom_auth = AuthContext(user_id="alice", is_admin=True)

    with p_get, p_val, p_save as mock_save, p_get_bp, p_exec:
        await instantiate_preset(
            preset_id=PresetId("preset-auth-save"),
            parameter_values={},
            auth_context=custom_auth,
        )

    call_kwargs = mock_save.call_args.kwargs
    assert call_kwargs["auth_context"] == custom_auth


# ===========================================================================
# Tests: blueprint display_name is set to the preset name
# ===========================================================================


@pytest.mark.asyncio
async def test_save_builder_receives_preset_name_as_display_name() -> None:
    """save_builder is called with display_name equal to the preset's name.

    This ensures instantiated blueprints appear in the execution list with the
    preset name rather than as 'Untitled'.
    """
    preset_name = "My Named Preset"
    db_row = _make_db_row(difficulty="beginner", name=preset_name)
    p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(db_row=db_row)

    with p_get, p_val, p_save as mock_save, p_get_bp, p_exec:
        await instantiate_preset(
            preset_id=PresetId("preset-named"),
            parameter_values={},
            auth_context=_AUTH,
        )

    mock_save.assert_awaited_once()
    payload = mock_save.call_args.kwargs["payload"]
    assert payload.display_name == preset_name, f"Expected display_name={preset_name!r}, got {payload.display_name!r}"


@pytest.mark.asyncio
async def test_save_builder_display_name_set_for_advanced_preset_with_auto_run() -> None:
    """Advanced presets with auto_run=True call save_builder with the preset name.

    Regression guard: difficulty no longer controls whether save_builder is called;
    auto_run does.  Advanced + auto_run=True should save with the correct display_name.
    """
    preset_name = "Advanced Preset"
    db_row = _make_db_row(difficulty="advanced", name=preset_name)
    p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(db_row=db_row)

    with p_get, p_val, p_save as mock_save, p_get_bp, p_exec:
        await instantiate_preset(
            preset_id=PresetId("preset-advanced-name"),
            parameter_values={},
            auth_context=_AUTH,
            auto_run=True,
        )

    mock_save.assert_awaited_once()
    payload = mock_save.call_args.kwargs["payload"]
    assert payload.display_name == preset_name


@pytest.mark.asyncio
async def test_save_builder_not_called_when_auto_run_false_is_false() -> None:
    """auto_run=False still calls save_builder (blueprint is always saved).

    Regression guard: auto_run=False saves the blueprint but skips the run.
    """
    db_row = _make_db_row(difficulty="advanced", name="Advanced Preset")
    p_get, p_val, p_save, p_get_bp, p_exec = _patch_collaborators(db_row=db_row)

    with p_get, p_val, p_save as mock_save, p_get_bp, p_exec as mock_exec:
        await instantiate_preset(
            preset_id=PresetId("preset-advanced-no-run"),
            parameter_values={},
            auth_context=_AUTH,
            auto_run=False,
        )

    # Blueprint is saved even when auto_run=False.
    mock_save.assert_awaited_once()
    # But no run is submitted.
    mock_exec.assert_not_awaited()

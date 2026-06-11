# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Service layer for the preset domain.

Owns:
- preset instantiation: materialising a preset template with user-provided
  parameter values, validating the result, and optionally saving a blueprint
  and submitting a run (controlled by the ``auto_run`` flag).

No HTTP exceptions are raised here; callers are responsible for mapping domain
exceptions (``PresetNotFound``, ``PresetInstantiationValidationError``) to HTTP
responses.
"""

import logging
from typing import cast

from forecastbox.domain.blueprint.service import (
    BlueprintBuilder,
    BlueprintSaveCommand,
    Tag,
    save_builder,
    validate_expand,
)
from forecastbox.domain.blueprint.types import BlueprintId
from forecastbox.domain.preset import db as preset_db
from forecastbox.domain.preset.exceptions import PresetInstantiationValidationError, PresetNotFound
from forecastbox.domain.preset.models import PresetParameter
from forecastbox.domain.preset.types import PresetId
from forecastbox.domain.run import service as run_service
from forecastbox.domain.run.types import RunId
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.pydantic import FiabBaseModel

logger = logging.getLogger(__name__)

# Mirrors `frontend/src/lib/system-tags.ts:ONEOFF_TAG` — hides the resulting
# blueprint from "My Configurations" so preset runs don't pollute the user's
# saved-config list. Drop this once the backend exposes a richer `source` field.
_ONEOFF_TAG = "__fiab:oneoff__"


class InstantiateResult(FiabBaseModel):
    """Result of instantiating a preset.

    When ``auto_run=True`` (the default) both ``blueprint_id`` and ``run_id``
    are populated.  When ``auto_run=False`` only the materialised ``builder``
    and ``blueprint_id`` / ``blueprint_version`` are returned; ``run_id`` and
    ``attempt_count`` are ``None``.
    """

    builder: BlueprintBuilder
    blueprint_id: BlueprintId | None
    blueprint_version: int | None
    run_id: RunId | None
    attempt_count: int | None


async def instantiate_preset(
    preset_id: PresetId,
    parameter_values: dict[str, str],
    auth_context: AuthContext,
    *,
    auto_run: bool = True,
) -> InstantiateResult:
    """Materialise a preset template and optionally submit a run.

    Steps:
    1. Load the preset from the database; raise ``PresetNotFound`` if absent.
    2. Deep-copy the ``builder_template`` so the stored template is never mutated.
    3. Inject parameter values (falling back to each parameter's ``default_value``
       when the caller omits a key) into ``builder.local_glyphs``.
    4. Validate the materialised builder via ``blueprint_service.validate_expand``;
       raise ``PresetInstantiationValidationError`` if there are any errors.
    5a. **auto_run=True**: save the builder as a blueprint (tagged as a
        one-off so it stays out of "My Configurations"), submit a run, and
        return an ``InstantiateResult`` with ``blueprint_id`` and ``run_id``.
    5b. **auto_run=False**: return only the materialised builder; nothing is
        persisted. The caller (typically the editor) is responsible for
        saving if and when the user explicitly chooses to.

    Args:
        preset_id: Stable identifier of the preset to instantiate.
        parameter_values: Caller-supplied glyph key → value overrides.  Keys
            that are absent fall back to the parameter's ``default_value``.
        auth_context: Identity of the calling user; forwarded to blueprint and
            run service calls.
        auto_run: When ``True`` (default) the blueprint is saved **and** a run
            is submitted immediately.  When ``False`` the blueprint is saved but
            no run is submitted — the caller is expected to open the result in
            the editor and submit manually.

    Returns:
        An ``InstantiateResult`` describing the outcome.

    Raises:
        PresetNotFound: The preset does not exist or has been soft-deleted.
        PresetInstantiationValidationError: The materialised builder fails
            blueprint validation.
    """
    # 1. Load preset from DB.
    db_row = await preset_db.get_preset(preset_id)
    if db_row is None:
        raise PresetNotFound(f"No Preset with id={preset_id!r}.")

    # Deserialise the stored JSON columns into typed domain objects.
    builder_template = BlueprintBuilder.model_validate(cast(dict, db_row.builder_template))
    raw_parameters: list[dict] = cast(list, db_row.parameters) or []
    parameters: list[PresetParameter] = [PresetParameter.model_validate(p) for p in raw_parameters]
    preset_name: str = cast(str, db_row.name)

    # 2. Deep-copy the builder template so the original is never mutated.
    builder = builder_template.model_copy(deep=True)

    # 3. Inject parameter values into local_glyphs, falling back to defaults.
    for param in parameters:
        builder.local_glyphs[param.glyph_key] = parameter_values.get(param.glyph_key, param.default_value)

    # 4. Validate the materialised builder.
    validation = await validate_expand(builder, auth_context, validate_only=True)
    if validation.global_errors or validation.block_errors:
        raise PresetInstantiationValidationError(
            global_errors=validation.global_errors,
            block_errors=dict(validation.block_errors),
        )

    # 5a. auto_run=True: save blueprint and submit run immediately.
    if auto_run:
        save_command = BlueprintSaveCommand(builder=builder, display_name=preset_name, tags=[Tag(key=_ONEOFF_TAG)])
        save_result = await save_builder(auth_context=auth_context, payload=save_command)

        blueprint = await run_service.get_blueprint_for_execution(save_result.blueprint_id, save_result.blueprint_version)
        if blueprint is None:
            # Should never happen immediately after saving, but guard defensively.
            raise RuntimeError(
                f"Blueprint {save_result.blueprint_id!r} v{save_result.blueprint_version} "
                "not found immediately after saving — this is an internal error."
            )

        execute_result = await run_service.execute(blueprint, auth_context)
        if execute_result.t is None:
            raise RuntimeError(f"Failed to submit run for preset {preset_id!r}: {execute_result.e}")

        return InstantiateResult(
            builder=builder,
            blueprint_id=save_result.blueprint_id,
            blueprint_version=save_result.blueprint_version,
            run_id=execute_result.t.run_id,
            attempt_count=execute_result.t.attempt_count,
        )

    # 5b. auto_run=False: return the materialised builder without persisting.
    # The editor handles saving when the user explicitly chooses to, which
    # keeps preset previews out of "My Configurations" entirely.
    return InstantiateResult(
        builder=builder,
        blueprint_id=None,
        blueprint_version=None,
        run_id=None,
        attempt_count=None,
    )

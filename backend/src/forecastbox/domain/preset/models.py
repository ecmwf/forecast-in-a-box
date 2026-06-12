# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Pydantic domain models for high-level presets."""

from __future__ import annotations

from enum import Enum

from pydantic import Field

from forecastbox.domain.blueprint.service import BlueprintBuilder
from forecastbox.domain.blueprint.types import BlueprintId
from forecastbox.utility.pydantic import FiabBaseModel


class PresetDifficulty(str, Enum):
    """Difficulty level for a preset."""

    beginner = "beginner"
    intermediate = "intermediate"
    advanced = "advanced"


class PresetParameter(FiabBaseModel):
    """A single user-facing parameter exposed by a preset."""

    glyph_key: str
    label: str
    description: str
    value_type: str
    """FableType string (e.g. ``"string"``, ``"integer"``, ``"enum"``)."""
    default_value: str


class HighLevelPreset(FiabBaseModel):
    """A curated, high-level preset that wraps a BlueprintBuilder with metadata."""

    preset_id: BlueprintId
    version: int
    name: str
    description: str
    long_description: str | None = None
    difficulty: PresetDifficulty
    tags: list[str] = []
    icon: str = Field(default="Cloud", description="Lucide icon name")
    builder_template: BlueprintBuilder
    parameters: list[PresetParameter] = []
    is_published: bool = False
    created_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None

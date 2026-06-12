# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Types for plugin-defined presets.

Presets are in-memory (not DB-stored) workflow templates that plugins expose
to users as ready-made starting points. Each preset bundles a set of
BlockInstances with optional user-facing parameters.
"""

from fiab_core.fable import BlockInstance, BlockInstanceId
from fiab_core.pydantic_utils import FiabCoreBaseModel


class PluginPresetParameter(FiabCoreBaseModel):
    """A single user-configurable parameter exposed by a preset."""

    glyph_key: str
    """Icon glyph key used to represent this parameter in the UI"""
    label: str
    """Short human-readable label for the parameter"""
    description: str
    """Extended description of what the parameter controls"""
    value_type: str
    """FableType expression describing the expected value (e.g. 'str', 'int')"""
    default_value: str
    """Default value for the parameter, serialized as a string"""


class PluginPresetDefinition(FiabCoreBaseModel):
    """A preset definition provided by a plugin.

    Presets are served in-memory and are never persisted to the database.
    They represent opinionated, pre-configured workflow templates that users
    can adopt as a starting point.
    """

    preset_id: str
    """Unique identifier for this preset within the plugin"""
    name: str
    """Human-readable name displayed in the preset catalogue"""
    description: str
    """Short description shown in catalogue listings"""
    long_description: str | None = None
    """Optional extended description with full details about the preset"""
    difficulty: str
    """Difficulty level indicator (e.g. 'beginner', 'intermediate', 'advanced')"""
    tags: list[str] = []
    """Searchable tags for filtering presets in the catalogue"""
    icon: str = "Cloud"
    """Icon name used to represent this preset in the UI"""
    blocks: dict[BlockInstanceId, BlockInstance]
    """The block instances that make up this preset's workflow"""
    parameters: list[PluginPresetParameter] = []
    """User-configurable parameters exposed by this preset"""

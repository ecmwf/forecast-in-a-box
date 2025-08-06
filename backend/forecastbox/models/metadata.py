# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import logging
import os
from typing import Any

import yaml
from forecastbox.rjsf import FieldWithUI, FormDefinition
from forecastbox.rjsf.jsonSchema import ObjectSchema, StringSchema
from forecastbox.rjsf.uiSchema import UIAdditionalProperties, UIStringField
from pydantic import BaseModel, Field, model_validator

from .utils import open_checkpoint

FORECAST_IN_A_BOX_METADATA = "forecast-in-a-box.json"
logger = logging.getLogger(__name__)


class ControlMetadata(BaseModel):
    _version: str = "1.0.0"

    pkg_versions: dict[str, str] = Field(default_factory=dict, examples=[{"numpy": "1.23.0", "pandas": "1.4.0"}])
    """Absolute overrides for the packages to install when running."""

    input_source: str | dict[str, str] = Field(default="mars")
    """Source of the input, if dictionary, refers to keys of nested input sources"""

    nested: dict[str, dict[str, Any] | str] | None = Field(default=None, examples=[])
    """Configuration if using nested input sources. Will use the CutoutInput to combine these sources.

    Control the source of these source with the `input_source` field.

    E.g.
    ----
    ```
        nested:
        lam:
                pre_processors:
                    - regrid:
                        area: ...
                        grid: ...
        global: {}
    ```
    """

    pre_processors: list[str | dict[str, Any]] = Field(default_factory=list)
    post_processors: list[str | dict[str, Any]] = Field(default_factory=list)

    environment_variables: dict[str, Any] = Field(default_factory=dict, examples=[{"MY_VAR": "value", "ANOTHER_VAR": "another_value"}])
    """Environment variables for execution."""

    @model_validator(mode="before")
    @classmethod
    def parse_yaml_dicts(cls, values):
        dict_fields = [
            "pkg_versions",
            "input_source",
            "nested",
            "environment_variables",
        ]

        def parse_yaml(val: Any) -> Any:
            if isinstance(val, str):
                try:
                    return yaml.safe_load(val)
                except yaml.YAMLError:
                    return val
            elif isinstance(val, dict):
                return {k: parse_yaml(v) for k, v in val.items()}
            return val

        for field in dict_fields:
            if values.get(field) is not None:
                values[field] = parse_yaml(values.get(field))
        return values

    @staticmethod
    def _dump_yaml(val: dict[str, Any] | str) -> str:
        """Dump a dictionary to a YAML string."""
        if isinstance(val, str):
            return val
        return yaml.safe_dump(val, indent=2, sort_keys=False)

    @property
    def form(self) -> FormDefinition:
        return FormDefinition(
            title="Control Metadata",
            fields={
                "input_source": FieldWithUI(
                    jsonschema=StringSchema(
                        title="Input Source",
                        description="Source of the input data, can be a string or a dictionary of sources.",
                        default=self._dump_yaml(self.input_source),
                    ),
                ),
                "nested": FieldWithUI(
                    jsonschema=ObjectSchema(
                        title="Nested Input Sources",
                        description="Configuration for nested input sources.",
                        additionalProperties=StringSchema(),
                        default=self._dump_yaml(self.nested or {}),
                    ),
                ),
                "pre_processors": FieldWithUI(
                    jsonschema=ObjectSchema(
                        title="Pre-processors",
                        description="List of pre-processors to apply to the input data.",
                        additionalProperties=StringSchema(),
                        default=list(map(self._dump_yaml, self.pre_processors)),
                    ),
                    ui=UIAdditionalProperties(
                        additionalProperties=UIStringField(widget="textarea", format="yaml")
                    )
                ),
                "post_processors": FieldWithUI(
                    jsonschema=ObjectSchema(
                        title="Post-processors",
                        description="List of post-processors to apply to the output data.",
                        additionalProperties=StringSchema(),
                        default=list(map(self._dump_yaml, self.post_processors)),
                    ),
                    ui=UIAdditionalProperties(
                        additionalProperties=UIStringField(widget="textarea", format="yaml")
                    )
                ),
                "pkg_versions": FieldWithUI(
                    jsonschema=ObjectSchema(
                        title="Package Versions",
                        description="Override package versions.",
                        additionalProperties=StringSchema(format="yaml"),
                        default=self.pkg_versions,
                    ),
                    ui=UIAdditionalProperties(
                        additionalProperties=UIStringField(widget="text")
                    )

                ),
                "environment_variables": FieldWithUI(
                    jsonschema=ObjectSchema(
                        title="Environment Variables",
                        description="Environment variables for execution.",
                        additionalProperties=StringSchema(),
                        default=self.environment_variables or {},
                    ),
                    ui=UIAdditionalProperties(
                        additionalProperties=UIStringField()
                    )
                )
            }
        )

    def update(self, **kwargs) -> "ControlMetadata":
        """Update the current metadata."""
        self_dump = self.model_dump(exclude_none=True)

        def merge(s,o):
            """Merge two dictionaries, with `o` overwriting `s`."""
            for key, value in o.items():
                if isinstance(value, dict) and key in s:
                    s[key] = merge(s[key], value)
                else:
                    s[key] = value
            return s

        updated_dump = merge(self_dump, kwargs)
        return ControlMetadata(**updated_dump)

    @staticmethod
    def from_checkpoint(checkpoint_path: os.PathLike) -> "ControlMetadata":
        """Load metadata from a checkpoint."""
        return get_control_metadata(checkpoint_path)

    def to_checkpoint(self, checkpoint_path: os.PathLike) -> None:
        """Save metadata to a checkpoint."""
        set_control_metadata(checkpoint_path, self)

def get_control_metadata(checkpoint_path: os.PathLike) -> ControlMetadata:
    """Get the control metadata from a checkpoint."""
    from anemoi.utils.checkpoints import has_metadata, load_metadata

    if not has_metadata(str(checkpoint_path), name=FORECAST_IN_A_BOX_METADATA):
        return ControlMetadata()

    loaded_metadata = load_metadata(str(checkpoint_path), name=FORECAST_IN_A_BOX_METADATA)
    try:
       return ControlMetadata(**loaded_metadata)
    except Exception as e:
        logger.warning(
            f"Failed to load control metadata from {checkpoint_path}: {e}. "
            "Returning an empty ControlMetadata instance and deleting the offending metadata."
        )
        from anemoi.utils.checkpoints import replace_metadata
        replace_metadata(
            str(checkpoint_path),
            {"version": ControlMetadata()._version},
            name=FORECAST_IN_A_BOX_METADATA,
        )
        return ControlMetadata()


def set_control_metadata(checkpoint_path: os.PathLike, control_data: ControlMetadata) -> None:
    """Set the control metadata for a checkpoint.

    This function updates the metadata of a checkpoint with the provided `control_data` metadata.
    If the metadata file does not exist, it creates a new one.

    Parameters
    ----------
    checkpoint_path : os.PathLike
        The path to the checkpoint file.
    control_data : ControlMetadata
        Control metadata to be saved.
    """
    from anemoi.utils.checkpoints import has_metadata, replace_metadata, save_metadata

    open_checkpoint.cache_clear()

    if not has_metadata(str(checkpoint_path), name=FORECAST_IN_A_BOX_METADATA):
        save_metadata(
            str(checkpoint_path),
            control_data.model_dump(),
            name=FORECAST_IN_A_BOX_METADATA,
        )
        return

    replace_metadata(
        str(checkpoint_path),
        {**control_data.model_dump(), "version": control_data._version},
        name=FORECAST_IN_A_BOX_METADATA,
    )

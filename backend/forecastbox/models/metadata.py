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
from forecastbox.rjsf.jsonSchema import BooleanSchema, IntegerSchema, ObjectSchema, StringSchema
from forecastbox.rjsf.uiSchema import UIAdditionalProperties, UIStringField
from pydantic import BaseModel, Field, model_validator

from .utils import open_checkpoint

FORECAST_IN_A_BOX_METADATA = "forecast-in-a-box.json"
logger = logging.getLogger(__name__)


processor_example = [{
    "regrid": {
        "area": "global",
        "grid": "0.25deg",
    }
}]


class Capabilities(BaseModel):
    ensemble: bool = True
    max_lead_time: int | None = None

class ControlMetadata(BaseModel):
    _version: str = "1.0.0"

    pkg_versions: dict[str, str] = Field(default_factory=dict, examples=[{"numpy": "1.23.0", "pandas": "1.4.0"}])
    """Absolute overrides for the packages to install when running."""

    input_source: str | dict[str, str] | None = Field(None, examples=["mars", {'polytope': {'collection': "..."}}])
    """Source of the input, if dictionary, refers to keys of nested input sources"""

    nested: dict[str, dict[str, Any] | str] | None = Field(default=None, examples=[
        {
            "lam": {
                "mars": {
                    "pre_processors": [
                        {"regrid": {"area": "...", "grid": "..."}}
                    ]
                }
            },
            'global': 'mars'
        },
    ])
    """Configuration if using nested input sources. Will use the CutoutInput to combine these sources.

    E.g.
    ----
    ```
        nested:
        lam:
            mars:
                pre_processors:
                    - regrid:
                        area: ...
                        grid: ...
        global: {}
    ```
    """

    pre_processors: dict[str, Any] = Field(default_factory=dict, examples=processor_example)
    post_processors: dict[str, Any] = Field(default_factory=dict, examples=processor_example)

    environment_variables: dict[str, Any] = Field(default_factory=dict, examples=[{"MY_VAR": "value", "ANOTHER_VAR": "another_value"}])
    """Environment variables for execution."""

    capabilities: Capabilities = Field(default_factory=Capabilities, examples=[{"ensemble": True, "max_lead_time": 240}])

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
                except yaml.YAMLError as e:
                    from pydantic import ValidationError
                    raise ValidationError(f"Invalid YAML format: {e}") from e
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
        data = self.model_dump(exclude_none=True)
        data.pop('_version', None)  # Remove version from form data

        for key in list(data.keys()):
            if isinstance(data[key], dict) and len(data[key]) == 0:
                data.pop(key)

        nested_dictionaries = ['nested', 'pre_processors', 'post_processors']

        for key in nested_dictionaries:
            if key in data and isinstance(data[key], dict):
                for k in data[key]:
                    data[key][k] = self._dump_yaml(data[key][k])

        return FormDefinition(
            title="Control Metadata",
            formData=data,
            fields={
                "input_source": FieldWithUI(
                    jsonschema=StringSchema(
                        title="Input Source",
                        description="Source of the input data, can be a string or a dictionary of sources.",
                        # default=self._dump_yaml(self.input_source),
                    ),
                ),
                "nested": FieldWithUI(
                    jsonschema=ObjectSchema(
                        title="Nested Input Sources",
                        description="Configuration for nested input sources.",
                        additionalProperties=StringSchema(),
                        # default=self._dump_yaml(self.nested or {}),
                    ),
                    ui=UIAdditionalProperties(
                        additionalProperties=UIStringField(widget="textarea", format="yaml")
                    )
                    ),
                    "capabilites": FieldWithUI(
                    jsonschema=ObjectSchema(
                        title="Capabilities",
                        properties={
                            "ensemble": BooleanSchema(title="Ensemble", description="Whether the model supports ensemble forecasts.", default=self.capabilities.ensemble),
                            "max_lead_time": IntegerSchema(title="Max Lead Time", description="Maximum lead time in hours for the model."),
                        },
                    ),
                ),
                "pre_processors": FieldWithUI(
                    jsonschema=ObjectSchema(
                        title="Pre-processors",
                        description="Pre-processors to apply to the input data. Key is the name of the pre-processor, value is the configuration.",
                        additionalProperties=StringSchema(),
                        # default=list(map(self._dump_yaml, self.pre_processors)),
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
                        # default=list(map(self._dump_yaml, self.post_processors)),
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
                        # default=self.pkg_versions,
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
                        # default=self.environment_variables or {},
                    ),
                    ui=UIAdditionalProperties(
                        additionalProperties=UIStringField(format="yaml")
                    )
                )
            }
        )

    def update(self, **kwargs: Any) -> "ControlMetadata":
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
        import asyncio

        from anemoi.utils.checkpoints import replace_metadata

        # If we are in an async context, use the event loop to run the replacement
        # Otherwise, run it synchronously

        if loop := asyncio.get_running_loop():
            def async_replace():
                replace_metadata(
                    str(checkpoint_path),
                    {"version": ControlMetadata()._version},
                    name=FORECAST_IN_A_BOX_METADATA,
                )
            loop.run_in_executor(None, async_replace)
        else:
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

    logger.info(f"Setting control metadata for {checkpoint_path}: {control_data.model_dump()}")

    if not has_metadata(str(checkpoint_path), name=FORECAST_IN_A_BOX_METADATA):
        save_metadata(
            str(checkpoint_path),
            {**control_data.model_dump(), "version": control_data._version},
            name=FORECAST_IN_A_BOX_METADATA,
        )
        return

    replace_metadata(
        str(checkpoint_path),
        {**control_data.model_dump(), "version": control_data._version},
        name=FORECAST_IN_A_BOX_METADATA,
    )

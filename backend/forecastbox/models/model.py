# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import os
from abc import ABC, abstractmethod
from collections import defaultdict
from functools import cached_property
from typing import Any, Optional

from anemoi.inference.checkpoint import Checkpoint
from earthkit.workflows.fluent import Action
from earthkit.workflows.plugins.anemoi.fluent import from_input
from forecastbox.rjsf import FieldWithUI, FormDefinition, IntegerSchema, StringSchema, UIIntegerField, UIStringField
from pydantic import BaseModel
from qubed import Qube

from .metadata import ControlMetadata, get_control_metadata
from .utils import open_checkpoint

FORECAST_IN_A_BOX_METADATA = "forecast-in-a-box.json"


class BaseForecastModel(ABC):
    def __init__(self, checkpoint: os.PathLike):
        self.checkpoint_path = checkpoint
        self.validate_checkpoint()

    def validate_checkpoint(self):
        """Validate the checkpoint."""
        pass

    @cached_property
    def checkpoint(self) -> Checkpoint:
        return open_checkpoint(self.checkpoint_path)

    @cached_property
    def metadata(self):
        """Get the metadata of the model."""
        return self.checkpoint._metadata

    @cached_property
    def control(self) -> ControlMetadata:
        return get_control_metadata(self.checkpoint_path).model_copy()

    @cached_property
    def timestep(self) -> int:
        """Get the timestep of the model in hours."""
        return int((self.checkpoint.timestep.total_seconds() + 1) // 3600)

    def timesteps(self, lead_time: int) -> list[int]:
        """Get the timesteps for the given lead time."""
        if lead_time < self.timestep:
            raise ValueError(f"Lead time {lead_time} must be greater than or equal to timestep {self.timestep}.")
        return list(range(self.timestep, int(lead_time) + 1, self.timestep))

    @cached_property
    def variables(self) -> list[str]:
        return [
            *self.checkpoint.diagnostic_variables,
            *self.checkpoint.prognostic_variables,
        ]

    @cached_property
    def accumulations(self) -> list[str]:
        return [
            *self.checkpoint.accumulations,
        ]

    @cached_property
    def versions(self) -> dict[str, str]:
        def parse_versions(key, val):
                if key.startswith("_"):
                    return None, None
                key = key.replace(".", "-")
                if "://" in val:
                    return key, val

                val = val.split("+")[0]
                return key, ".".join(val.split(".")[:3])

        versions = {
            key: val
            for key, val in (parse_versions(key, val) for key, val in self.checkpoint.provenance_training().get("module_versions", {}).items())
            if key is not None and val is not None
        }

        extra_versions = self.control.pkg_versions or {}
        versions.update(extra_versions or {})

        return versions


    @property
    def ignore_in_select(self) -> list[str]:
        return ["frequency"]

    def qube(self, assumptions: dict[str, Any] | None = None) -> Qube:
        """Get Model Qube.

        The Qube is a representation of the model parameters and their
        dimensions.
        Parameters are represented as 'param' and their levels
        as 'levelist'. Which differs from the graph where each param and level
        are represented as separate nodes.
        """
        return convert_to_model_spec(self.checkpoint, assumptions=assumptions)


    # -------
    # Abstract methods
    # To define graph execution and input configuration
    # -------

    @abstractmethod
    def _create_input_configuration(self, control: ControlMetadata) -> str | dict[str, Any]:
        pass

    def _pre_processors(self, kwargs: dict[str, Any]) -> list[dict[str, Any]]:
        """Get the pre-processors for the model."""
        return []
    def _post_processors(self, kwargs: dict[str, Any]) -> list[dict[str, Any]]:
        """Get the post-processors for the model."""
        return []

    @property
    def _pkg_versions(self) -> dict[str, str]:
        """Model specific override for package versions."""
        return {}

    @property
    def _execution_kwargs(self) -> dict[str, Any]:
        """Model specific execution kwargs."""
        return {}

    def graph(self, lead_time: int, date, ensemble_members: int = 1, **kwargs) -> Action:
        """Create the model action graph with specified parameters."""
        versions = self.versions
        INFERENCE_FILTER_INCLUDE = ["anemoi-models", "anemoi-graphs", "flash-attn", "torch", "torch_geometric"]
        INITIAL_CONDITIONS_FILTER_STARTS = ["anemoi-inference", "earthkit", "anemoi-transform", "anemoi-plugins"]

        def parse_into_install(version_dict):
            install_list = []
            for key, val in version_dict.items():
                if "://" in val or "git+" in val or val.startswith("/"):
                    install_list.append(f"{key}@{val}")
                else:
                    install_list.append(f"{key}=={val}")
            return install_list

        control = self.control.update(**kwargs)

        inference_env = {
            key: val for key, val in versions.items() if key in INFERENCE_FILTER_INCLUDE
        }

        inference_env.update(self._pkg_versions)
        inference_env.update(control.pkg_versions)
        inference_env_list = parse_into_install(inference_env)

        initial_conditions_env = parse_into_install(
            {
                key: val
                for key, val in versions.items()
                if any(key.startswith(start) for start in INITIAL_CONDITIONS_FILTER_STARTS)
            }
        )

        input_source = self._create_input_configuration(control)

        if isinstance(input_source, str):
            input_source = {input_source: {}}

        extra_kwargs = {
            'pre_processors': [],
            'post_processors': [],
        }
        if control.pre_processors:
            extra_kwargs["pre_processors"].extend(control.pre_processors)
        if control.post_processors:
            extra_kwargs["post_processors"].extend(control.post_processors)

        extra_kwargs['pre_processors'].extend(self._pre_processors(kwargs))
        extra_kwargs['post_processors'].extend(self._post_processors(kwargs))

        return from_input(
            self.checkpoint_path,
            input_source,
            lead_time=lead_time,
            date=date,
            ensemble_members=ensemble_members,
            environment={"inference": inference_env_list, "initial_conditions": initial_conditions_env},
            **extra_kwargs,
            **self._execution_kwargs,
        )

    def deaccumulate(self, outputs: "Action") -> "Optional[Action]":
        """Get the deaccumulated outputs."""
        accumulated_fields = self.accumulations

        steps = outputs.nodes.coords["step"]

        fields: Action | None = None

        for field in self.variables:
            if field not in accumulated_fields:
                if fields is None:
                    fields = outputs.sel(param=field)
                else:
                    fields = fields.join(outputs.sel(param=[field]), "param")
                continue

            deaccumulated_steps: Action = outputs.sel(param=[field]).isel(step=[0])

            for i in range(1, len(steps)):
                t_0 = outputs.sel(param=[field]).isel(step=[i - 1])
                t_1 = outputs.sel(param=[field]).isel(step=[i])

                deaccum = t_1.subtract(t_0)
                deaccumulated_steps = deaccumulated_steps.join(deaccum, "step")

            if fields is None:
                fields = deaccumulated_steps
            else:
                fields = fields.join(deaccumulated_steps, "param")

        return fields

    def specify(self, lead_time: int, date, ensemble_members: int = 1, **kwargs) -> "SpecifiedModel":
        """Create a SpecifiedModel instance with the given parameters."""
        return SpecifiedModel(self, lead_time, date, ensemble_members, **kwargs)

    @property
    def is_global(self) -> bool:
        return self.control.nested is None

    # -------
    # Model Definition Forms
    # -------

    @property
    def _extra_form_fields(self) -> dict[str, FieldWithUI]:
        """Extra fields to be added to the model definition form."""
        return {}

    @property
    def form(self) -> FormDefinition:
        name = os.path.basename(self.checkpoint_path)
        title = f"Model: {name}"
        fields = {
            "date": FieldWithUI(
                jsonschema=StringSchema(
                    title="Date",
                    description="The date for the forecast",
                ),
                ui=UIStringField(widget="date"),
            ),
            "lead_time": FieldWithUI(
                jsonschema=IntegerSchema(
                    title="Lead Time",
                    description="The lead time for the forecast, in hours.",
                    minimum=self.timestep,
                    default=self.control.capabilities.max_lead_time or 72,
                    maximum=self.control.capabilities.max_lead_time,
                    multipleOf= self.timestep,
                ),
                ui=UIIntegerField(),
            ),
            "ensemble_members": FieldWithUI(
                jsonschema=IntegerSchema(
                    title="Ensemble Members",
                    description="The number of ensemble members to use.",
                    default=1,
                    maximum=51,
                ),
                ui=UIIntegerField(disabled=not self.control.capabilities.ensemble),
            ),
        }
        fields.update(self._extra_form_fields)
        return FormDefinition(
            title=title,
            fields=fields,
            required=["date", "lead_time", "ensemble_members"],
        )

class SpecifiedModel(BaseForecastModel):
    """Model with specified parameters, delegating to a BaseForecastModel instance."""
    def __init__(self, model: BaseForecastModel, lead_time: int, date, ensemble_members: int = 1, **kwargs):
        self._model = model
        self._kwargs = kwargs
        self._lead_time = lead_time
        self._date = date
        self._ensemble_members = ensemble_members

    def _create_input_configuration(self, control: ControlMetadata) -> str | dict[str, Any]:
        return self._model._create_input_configuration(control)

    def timesteps(self) -> list[int]: # type: ignore[override]
        return self._model.timesteps(self._lead_time)

    @property
    def specification(self) -> dict[str, Any]:
        """Get the specification of the model."""
        return {
            "lead_time": self._lead_time,
            "date": self._date,
            "ensemble_members": self._ensemble_members,
            **self._kwargs,
        }

    def graph(self, **kwargs) -> Action: # type: ignore[override]
        """Create the model action graph with specified parameters."""
        k = self._kwargs.copy()
        k.update(kwargs)
        return self._model.graph(
            lead_time=self._lead_time,
            date=self._date,
            ensemble_members=self._ensemble_members,
            **k,
        )

    def __getattr__(self, key):
        return getattr(self._model, key)



# class Model(BaseModel, FormFieldProvider):
#     """Model Specification"""

#     model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

#     checkpoint_path: FilePath
#     lead_time: int
#     date: str
#     ensemble_members: int
#     time: str | None = None
#     entries: dict[str, Any] | None = None


def get_model(checkpoint: os.PathLike) -> BaseForecastModel:
    """Get the model class based on the control metadata."""
    from .globe import GlobalModel
    from .nested import NestedModel

    control = get_control_metadata(checkpoint)

    if control.nested is not None:
        return NestedModel(checkpoint)
    return GlobalModel(checkpoint)


class ModelInfo(BaseModel):
    timestep: int
    diagnostics: list[str]
    prognostics: list[str]
    area: Any
    grid: Any
    versions: dict[str, str]
    type: str

def model_info(checkpoint_path: os.PathLike) -> ModelInfo:
    """Get basic information about the model from the checkpoint.
    This includes the timestep, diagnostic and prognostic variables,
    area, grid, and versions.
    """
    model = get_model(checkpoint_path)

    anemoi_versions = {
        k: v
        for k, v in model.versions.items()
        if any(k.startswith(prefix) for prefix in ["anemoi-", "earthkit-", "torch", "flash-attn"])
    }

    return ModelInfo(
        timestep=model.timestep,
        diagnostics=model.metadata.diagnostic_variables,
        prognostics=model.metadata.prognostic_variables,
        area=model.metadata.area,
        grid=model.metadata.grid,
        versions=anemoi_versions,
        type=model.__class__.__name__,
    )



def convert_to_model_spec(ckpt: Checkpoint, assumptions: dict[str, Any] | None = None) -> Qube:
    """Convert an anemoi checkpoint to a Qube."""
    variables = [
        *ckpt.diagnostic_variables,
        *ckpt.prognostic_variables,
    ]

    assumptions = assumptions or {}

    # Split variables between pressure and surface
    surface_variables = [v for v in variables if "_" not in v]

    # Collect the levels for each pressure variable
    level_variables = defaultdict(list)
    for v in variables:
        if "_" in v:
            variable, level = v.split("_")
            level_variables[variable].append(int(level))

    model_tree = Qube.empty()

    for variable, levels in level_variables.items():
        model_tree = model_tree | Qube.from_datacube(
            {
                "frequency": ckpt.timestep,
                "levtype": "pl",
                "param": variable,
                "levelist": list(map(str, sorted(map(int, levels)))),
                **assumptions,
            }
        )

    for variable in surface_variables:
        model_tree = model_tree | Qube.from_datacube(
            {
                "frequency": ckpt.timestep,
                "levtype": "sfc",
                "param": variable,
                **assumptions,
            }
        )

    return model_tree

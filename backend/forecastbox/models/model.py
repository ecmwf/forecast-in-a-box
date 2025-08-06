# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import os
from abc import ABCMeta, abstractmethod
from collections import defaultdict
from functools import cached_property
from typing import Any, Optional

from anemoi.inference.checkpoint import Checkpoint
from earthkit.workflows.fluent import Action
from earthkit.workflows.plugins.anemoi.fluent import from_input
from forecastbox.core import FormFieldProvider
from forecastbox.rjsf import FieldWithUI
from pydantic import BaseModel, ConfigDict, FilePath
from qubed import Qube

from .metadata import ControlMetadata, get_control_metadata
from .utils import open_checkpoint

FORECAST_IN_A_BOX_METADATA = "forecast-in-a-box.json"


class BaseForecastModel(FormFieldProvider, ABCMeta):
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
        return get_control_metadata(str(self.checkpoint_path)).model_copy()

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
            for key, val in (parse_versions(key, val) for key, val in self.checkpoint.provenance_training()["module_versions"].items())
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


    @abstractmethod
    def _create_input_configuration(self):
        pass

    @abstractmethod
    def graph(self, lead_time: int, date: str | int, ensemble_members: int = 1, **kwargs) -> Action:
        pass

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

class Model(BaseModel, FormFieldProvider):
    """Model Specification"""

    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    checkpoint_path: FilePath
    lead_time: int
    date: str
    ensemble_members: int
    time: str | None = None
    entries: dict[str, Any] | None = None

    @property
    def formfields(self) -> dict[str, "FieldWithUI"]:
        return {
            # 'date': FieldWithUI(
            #     jsonschema= StringSchema(
            #         title="Date",
            #         description="Date of the forecast in YYYY-MM-DD format.",
            #         format="date",
            #     ),
            #     ui=UIStringField(
            #         widget="date",
            #         inputType="date",
            #         label=False,
            #         placeholder="YYYY-MM-DD",
            #     )
            # ),
            # 'lead_time': FieldWithUI(
            #     jsonschema=IntegerSchema(
            #         title="Lead Time",
            #         description="Lead time for the forecast in hours.",
            #         minimum=0,
            #         maximum=self.lead_time,
            #         multipleOf=self.timestep,
            #     ),
            #     ui=UIIntegerField(
            #         widget='range',
            #         label=False,
            #         placeholder="Enter lead time in hours",
            #     )
            # ),
        }




    @cached_property
    def timesteps(self) -> list[int]:
        return list(range(self.timestep, int(self.lead_time) + 1, self.timestep))


    def graph(self, initial_conditions: "Action", environment_kwargs: dict | None = None, **kwargs) -> "Action":
        """Get Model Graph.

        Anemoi cascade exposes each param as a separate node in the graph,
        with pressure levels represented as `{param}_{levelist}`.
        """

        versions = self.versions()
        INFERENCE_FILTER_STARTS = ["anemoi-models", "anemoi-graphs", "flash-attn", "torch"]
        INITIAL_CONDITIONS_FILTER_STARTS = ["anemoi-inference", "earthkit", "anemoi-transform", "anemoi-plugins"]

        def parse_into_install(version_dict):
            install_list = []
            for key, val in version_dict.items():
                if "://" in val or "git+" in val:
                    install_list.append(f"{key} @ {val}")
                else:
                    install_list.append(f"{key}=={val}")
            return install_list

        additional_constraints = self.extra_information.model_dump()
        additional_constraints.update(kwargs)
        additional_constraints = ModelExtra(**additional_constraints)

        inference_env = {
            key: val for key, val in versions.items() if any(key.startswith(start) for start in INFERENCE_FILTER_STARTS)
        }

        inference_env.update(additional_constraints.version_overrides or {})
        inference_env_list = parse_into_install(inference_env)

        initial_conditions_env = parse_into_install(
            {
                key: val
                for key, val in versions.items()
                if any(key.startswith(start) for start in INITIAL_CONDITIONS_FILTER_STARTS)
            }
        )

        inference_environment_variables = (additional_constraints.environment_variables or {}).copy()
        inference_environment_variables.update(environment_kwargs or {})

        input_source = additional_constraints.input_preference or "mars"
        if additional_constraints.input_overrides:
            input_source = {input_source: additional_constraints.input_overrides}

        return from_input(
            self.checkpoint_path,
            input_source,
            lead_time=self.lead_time,
            date=self.date,
            ensemble_members=self.ensemble_members,
            **(self.entries or {}),
            environment={"inference": inference_env_list, "initial_conditions": initial_conditions_env},
            env=inference_environment_variables,
        )




def model(checkpoint: os.PathLike) -> BaseForecastModel:
    """Get the model class based on the control metadata."""
    from .globe import GlobalModel
    from .nested import NestedModel

    control = get_control_metadata(checkpoint)
    if control.nested:
        return NestedModel(checkpoint)
    return GlobalModel(checkpoint)



def model_info(checkpoint_path: str) -> dict[str, Any]:
    ckpt = open_checkpoint(checkpoint_path)

    anemoi_versions = model_versions(checkpoint_path)
    anemoi_versions = {
        k: v
        for k, v in anemoi_versions.items()
        if any(k.startswith(prefix) for prefix in ["anemoi-", "earthkit-", "torch", "flash-attn"])
    }

    return {
        "timestep": ckpt.timestep,
        "diagnostics": ckpt.diagnostic_variables,
        "prognostics": ckpt.prognostic_variables,
        "area": ckpt.area,
        "local_area": True,
        "grid": ckpt.grid,
        "versions": anemoi_versions,
    }



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

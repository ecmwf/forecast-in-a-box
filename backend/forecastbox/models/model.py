from collections import defaultdict
from functools import cached_property, lru_cache

from pydantic import BaseModel, FilePath

from typing import Any

from qubed import Qube
from earthkit.workflows.fluent import Action

from earthkit.workflows.plugins.anemoi.fluent import from_input
from anemoi.inference.checkpoint import Checkpoint


@lru_cache
def open_checkpoint(checkpoint_path: str) -> Checkpoint:
    """Open a checkpoint from the given path."""
    return Checkpoint(checkpoint_path)


class Model(BaseModel):
    """Model Specification"""

    class Config:
        frozen = True
        arbitrary_types_allowed = True

    checkpoint_path: FilePath
    lead_time: int
    date: str
    ensemble_members: int
    time: str = None
    entries: dict[str, Any] = None

    @cached_property
    def checkpoint(self) -> Checkpoint:
        return open_checkpoint(self.checkpoint_path)

    @cached_property
    def timesteps(self) -> list[int]:
        model_step = int((self.checkpoint.timestep.total_seconds() + 1) // 3600)
        return list(range(model_step, int(self.lead_time) + 1, model_step))

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

    def qube(self, assumptions: dict[str, Any] | None = None) -> Qube:
        """Get Model Qube.

        The Qube is a representation of the model parameters and their
        dimensions.
        Parameters are represented as 'param' and their levels
        as 'levelist'. Which differs from the graph where each param and level
        are represented as separate nodes.
        """
        return convert_to_model_spec(self.checkpoint, assumptions=assumptions)

    def graph(self, initial_conditions: "Action", **kwargs) -> "Action":
        """Get Model Graph.

        Anemoi cascade exposes each param as a separate node in the graph,
        with pressure levels represented as 'param_levelist'.
        """

        versions = self.versions(self.checkpoint_path, filter=False)
        BLACKLISTED_INSTALLS = ["anemoi", "anemoi-training", "anemoi-inference", "anemoi-utils"]
        FILTER_STARTS = ["anemoi", "flash"]

        env = [
            f"{key}=={val}"
            for key, val in versions.items()
            if key not in BLACKLISTED_INSTALLS and any(key.startswith(start) for start in FILTER_STARTS)
        ]

        return from_input(
            self.checkpoint_path,
            "mars",
            lead_time=self.lead_time,
            date=self.date,
            ensemble_members=self.ensemble_members,
            **(self.entries or {}),
            environment={"inference": env},
            env={"ANEMOI_INFERENCE_NUM_CHUNKS": 4},
        )

    def deaccumulate(self, outputs: "Action") -> "Action":
        """
        Get the deaccumulated outputs.
        """
        accumulated_fields = self.accumulations

        steps = outputs.nodes.coords["step"]

        fields: Action = None

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

    @property
    def ignore_in_select(self) -> list[str]:
        return ["frequency"]

    @classmethod
    def versions(cls, checkpoint_path: str, filter: bool = True) -> dict[str, str]:
        """Get the versions of the model"""

        ckpt = open_checkpoint(checkpoint_path)

        def parse_versions(key, val):
            if key.startswith("_"):
                return None, None
            if "." not in val or "/" in val:
                return None, None
            return key.replace(".", "-"), ".".join(val.split(".")[:3])

        versions = {
            key: val
            for key, val in (parse_versions(key, val) for key, val in ckpt.provenance_training()["module_versions"].items())
            if key is not None and val is not None
        }

        if not filter:
            return versions
        return {key: val for key, val in versions.items() if key.startswith("anemoi")}

    @classmethod
    def info(cls, checkpoint_path: str) -> dict[str, Any]:
        """Get the model info"""

        ckpt = open_checkpoint(checkpoint_path)

        return {
            "timestep": ckpt.timestep,
            "diagnostics": ckpt.diagnostic_variables,
            "prognostics": ckpt.prognostic_variables,
            "area": ckpt.area,
            "local_area": True,
            "grid": ckpt.grid,
            "versions": cls.versions(checkpoint_path),
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

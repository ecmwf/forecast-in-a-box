import os
from collections import defaultdict
from dataclasses import dataclass

from typing import TYPE_CHECKING, Any

from qubed import Qube
from anemoi.cascade.fluent import from_initial_conditions, from_input
from anemoi.inference.checkpoint import Checkpoint

if TYPE_CHECKING:
    from earthkit.workflows.fluent import Action


@dataclass
class Model:
    """Model Specification"""
    checkpoint_path: os.PathLike
    lead_time: int
    date: str
    ensemble_members: int
    time: str = None
    entries: dict[str, Any] = None

    @property
    def checkpoint(self) -> "Checkpoint":
        return Checkpoint(self.checkpoint_path)
    
    @property
    def timesteps(self) -> list[int]:
        model_step = int((self.checkpoint.timestep.total_seconds()+1) // 3600)
        return list(range(model_step, int(self.lead_time)+1, model_step))

    def qube(self, assumptions: dict[str, Any] | None = None) -> Qube:
        """Get Model Qube.
        
        The Qube is a representation of the model parameters and their
        dimensions. Parameters are represented as 'param' and their levels
        as 'levelist'. Which differs from the graph where each param and level
        are represented as separate nodes.
        """
        return convert_to_model_spec(self.checkpoint, assumptions=assumptions)

    def graph(self, initial_conditions: "Action", **kwargs) -> "Action":
        """Get Model Graph.
        
        Anemoi cascade exposes each param as a separate node in the graph,
        with pressure levels represented as 'param_levelist'.
        """
        return from_input(
            self.checkpoint_path, "mars", lead_time=self.lead_time, date=self.date, ensemble_members=self.ensemble_members, **(self.entries or {})
        )

    @property
    def ignore_in_select(self) -> list[str]:
        return ["frequency"]
    
    @classmethod
    def versions(cls, checkpoint_path: str) -> dict[str, str]:
        """Get the versions of the model"""
        from anemoi.inference.checkpoint import Checkpoint

        ckpt = Checkpoint(checkpoint_path)
        return {key.replace('.','-'): '.'.join(val.split('.')[:3]) for key, val in ckpt.provenance_training()["module_versions"].items() if key.startswith("anemoi")}
    
    @classmethod
    def info(cls, checkpoint_path: str) -> dict[str, Any]:
        """Get the model info"""
        from anemoi.inference.checkpoint import Checkpoint

        ckpt = Checkpoint(checkpoint_path)

        return {
            "timestep": ckpt.timestep,
            "diagnostics": ckpt.diagnostic_variables,
            "prognostics": ckpt.prognostic_variables,
            "area": ckpt.area,
            "local_area": True,
            "grid": ckpt.grid,
            "versions": cls.versions(checkpoint_path),
        }
    
def convert_to_model_spec(ckpt: "Checkpoint", assumptions: dict[str, Any] | None = None) -> Qube:
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

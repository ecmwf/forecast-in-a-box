import os
from collections import defaultdict
from dataclasses import dataclass

from typing import TYPE_CHECKING, Any

from qubed import Qube
from anemoi.cascade.fluent import from_initial_conditions, from_input
from anemoi.inference.checkpoint import Checkpoint

if TYPE_CHECKING:
    from cascade.fluent import Action


class Model:
    """Model Specification"""

    def __init__(self, checkpoint_path: os.PathLike, lead_time: int, date, ensemble_members, **kwargs):
        self.checkpoint_path = checkpoint_path
        self.lead_time = lead_time
        self.date = date
        self.ensemble_members = ensemble_members
        self.kwargs = kwargs

    @property
    def checkpoint(self) -> "Checkpoint":
        return Checkpoint(self.checkpoint_path)
    
    @property
    def timesteps(self) -> list[int]:
        return list(range(0, int(self.lead_time), int((self.checkpoint.timestep.total_seconds()+1) // 3600)))

    def qube(self, assumptions: dict[str, Any] | None = None) -> Qube:
        """Get Model Qube"""
        return convert_to_model_spec(self.checkpoint, assumptions=assumptions)

    def graph(self, initial_conditions: "Action") -> "Action":
        """Get Model Graph"""
        return from_input(
            self.checkpoint_path, "mars", lead_time=self.lead_time, date=self.date, ensemble_members=self.ensemble_members, **self.kwargs
        )

    @property
    def ignore_in_select(self) -> list[str]:
        return ["frequency"]


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
                # "levelist": list(map(str, levels)), # TODO, Removed due to anemoi cascade not expanding levlist
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

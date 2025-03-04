import os
from collections import defaultdict

from typing import TYPE_CHECKING, Any

from qubed import Qube

if TYPE_CHECKING:
    from anemoi.inference.checkpoint import Checkpoint

MODEL_CHECKPOINT_PATH = os.getenv("FIAB_MODELS", "/tmp/fiab/models")
TESTING_LOOKUP = {
    'aifs-single': {'huggingface':'ecmwf/aifs-single-1.0'},
    'aifs-single-0.2.1': {'huggingface':'ecmwf/aifs-single-0.2.1'},
}

def open_checkpoint(model_name: str) -> "Checkpoint":
    """Open an anemoi checkpoint."""

    from anemoi.inference.checkpoint import Checkpoint

    if model_name in TESTING_LOOKUP:
        model_name = TESTING_LOOKUP[model_name] # type: ignore
    else:
        model_name = os.path.join(MODEL_CHECKPOINT_PATH, model_name)

    return Checkpoint(model_name)

def convert_to_model_spec(ckpt: "Checkpoint") -> Qube:
    """Convert an anemoi checkpoint to a Qube."""
    variables = [
        *ckpt.diagnostic_variables,
        *ckpt.prognostic_variables,
    ]

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
                "levtype": "pl",
                "param": variable,
                "level": levels,
                "frequency": ckpt.timestep,
            }
        )

    for variable in surface_variables:
        model_tree = model_tree | Qube.from_datacube(
            {
                "levtype": "sfc",
                "param": variable,
                "frequency": ckpt.timestep,
            }
        )

    return model_tree
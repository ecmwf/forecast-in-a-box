#!/usr/bin/env -S uv run
# /// script
# dependencies = [
#    "earthkit-workflows-anemoi",
#    "anemoi-inference",
#    "fire",
# ]
# ///


from functools import lru_cache
from typing import TypedDict

from qubed import Qube


class QubesInfo(TypedDict):
    input: Qube
    output: Qube


@lru_cache(maxsize=None)
def open_checkpoint(checkpoint_path: str) -> "Checkpoint":  # type: ignore
    from anemoi.inference.checkpoint import Checkpoint  # type: ignore

    return Checkpoint(checkpoint_path)


def get_qubes(checkpoint_path: str) -> QubesInfo:

    checkpoint = open_checkpoint(checkpoint_path)
    metadata = checkpoint._metadata
    variables_metadata = metadata.typed_variables

    from earthkit.workflows.plugins.anemoi.utils import _expansion_qube

    in_variables = metadata.select_variables(include=["prognostic", "forcing", "constant"], has_mars_requests=False)
    out_variables = metadata.select_variables(include=["diagnostic", "prognostic"], has_mars_requests=False)
    model_step = metadata.timestep.seconds

    in_qube = _expansion_qube(in_variables, variables_metadata, model_step, 6).remove_by_key("step")
    out_qube = _expansion_qube(out_variables, variables_metadata, model_step, 6).remove_by_key("step")

    return QubesInfo(input=in_qube, output=out_qube)


def get_package_versions(checkpoint_path: str) -> list[str]:
    checkpoint = open_checkpoint(checkpoint_path)

    deps = ["anemoi.models", "torch", "torch_geometric"]
    return [f"{dep}=={checkpoint._metadata.provenance_training()['module_versions'][dep]}" for dep in deps]


def get_bytes_on_disk(checkpoint_path: str) -> int:
    import os

    return os.path.getsize(checkpoint_path)


def get_info(checkpoint_path: str) -> None:
    print(f"Checkpoint path: {checkpoint_path}")
    print(f"Package versions: {get_package_versions(checkpoint_path)}")
    qubes = get_qubes(checkpoint_path)
    import json

    print("Input qube:")
    print(json.dumps(qubes["input"].to_json()))
    print("Output qube:")
    print(json.dumps(qubes["output"].to_json()))
    print(f"Bytes on disk: {get_bytes_on_disk(checkpoint_path)}")


if __name__ == "__main__":
    import fire

    fire.Fire(get_info)

#!/usr/bin/env -S uv run
# /// script
# dependencies = [
#    "earthkit-workflows-anemoi",
#    "anemoi-inference",
#    "fire",
# ]
# ///


from functools import lru_cache


@lru_cache(maxsize=None)
def open_checkpoint(checkpoint_path: str) -> "Checkpoint":  # type: ignore
    from anemoi.inference.checkpoint import Checkpoint  # type: ignore

    return Checkpoint(checkpoint_path)


def get_output_qube(checkpoint_path: str) -> str:
    import json

    checkpoint = open_checkpoint(checkpoint_path)

    from earthkit.workflows.plugins.anemoi.utils import expansion_qube_from_metadata

    qube = expansion_qube_from_metadata(checkpoint._metadata, lead_time=12)
    return json.dumps(qube.remove_by_key("step").to_json())


def get_package_versions(checkpoint_path: str) -> list[str]:
    checkpoint = open_checkpoint(checkpoint_path)

    deps = ["anemoi.models", "torch", "torch_geometric"]
    return [f"{dep}=={checkpoint._metadata.provenance_training()['module_versions'][dep]}" for dep in deps]


def get_bytes_on_disk(checkpoint_path: str) -> int:
    import os

    return os.path.getsize(checkpoint_path)


def get_info(checkpoint_path: str) -> None:
    print(get_package_versions(checkpoint_path))
    print(get_output_qube(checkpoint_path))
    print(get_bytes_on_disk(checkpoint_path))


if __name__ == "__main__":
    import fire

    fire.Fire(get_info)

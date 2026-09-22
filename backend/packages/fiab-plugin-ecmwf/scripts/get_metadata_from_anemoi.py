#!/usr/bin/env -S uv run
# /// script
# dependencies = [
#    "earthkit-workflows>=0.9.0",
#    "earthkit-workflows-anemoi>=0.7.2",
#    "qubed",
#    "anemoi-inference",
#    "metkitlib",
#    "pymetkit",
#    "qubed",
#    "fire",
#    "fiab-core",
# ]
#
# [tool.uv.sources]
# fiab-core = { path = "../../fiab-core", editable = true }
# ///

"""
Extract metadata from an Anemoi checkpoint and print a serialised
AnemoiCheckpoint entry suitable for pasting into an artifacts.json file.

Usage:
    ./get_metadata_from_anemoi.py <checkpoint_path> [--url=...] [--display_name=...] ...
"""

from functools import lru_cache
from typing import Any, cast, get_args

from fiab_core.artifacts import AnemoiCheckpoint, CommonArtifactMetadata, Platform

extra_output_keys = {"class": "ai", "type": "fc", "stream": "oper"}


@lru_cache(maxsize=None)
def open_checkpoint(checkpoint_path: str) -> "Checkpoint":  # ty: ignore[unresolved-reference]
    from anemoi.inference.checkpoint import Checkpoint  # ty: ignore[unresolved-import]

    return Checkpoint(checkpoint_path)


def get_qubes(checkpoint_path: str) -> dict[str, Any]:
    checkpoint = open_checkpoint(checkpoint_path)
    metadata = checkpoint._metadata
    variables_metadata = metadata.typed_variables

    from earthkit.workflows.plugins.anemoi.utils import _expansion_qube
    from pymetkit.paramdb import ParamDB
    from qubed import Qube
    from qubed.value_types import QEnum

    in_variables = metadata.select_variables(include=["prognostic", "forcing", "constant"], has_mars_requests=False)
    out_variables = metadata.select_variables(include=["diagnostic", "prognostic"], has_mars_requests=False)
    model_step = metadata.timestep.seconds

    in_qube = _expansion_qube(in_variables, variables_metadata, model_step, 6).remove_by_key("step")
    out_qube = _expansion_qube(out_variables, variables_metadata, model_step, 6).remove_by_key("step")
    out_qube.to_json()

    def _shortname_to_param_id(node: Qube) -> None:
        if node.key == "param":
            paramdb = ParamDB()
            new_values = [str(paramdb.shortname_to_param_id(x, context={"class": "ai"}, access="dissemination")) for x in node.values]
            node.values = QEnum(new_values)

    out_qube.walk(_shortname_to_param_id)
    return {"input_qube": in_qube.to_json(), "output_qube": out_qube.to_json()}


def get_package_versions(checkpoint_path: str) -> list[str]:
    checkpoint = open_checkpoint(checkpoint_path)
    module_versions = checkpoint._metadata.provenance_training()["module_versions"]

    deps = ["anemoi.models", "anemoi-graphs", "torch", "torch_geometric"]
    result = []
    for dep in deps:
        if dep not in module_versions:
            continue
        version = module_versions[dep]
        # non-registry installs (editable/git) report a DotDict with 'version' and 'source' instead of a plain string
        if hasattr(version, "version"):
            version = version.version
        result.append(f"{dep}=={version}")
    return result


def get_bytes_on_disk(checkpoint_path: str) -> int:
    import os

    return os.path.getsize(checkpoint_path)


def parse_platforms(supported_platforms: str) -> list[Platform]:
    valid: set[str] = set(get_args(Platform))
    result: list[Platform] = []
    for raw in supported_platforms.split(","):
        platform = raw.strip()
        if not platform:
            continue
        if platform not in valid:
            raise ValueError(f"unsupported platform {platform!r}, expected one of {sorted(valid)}")
        result.append(cast(Platform, platform))
    return result


def get_timestep(checkpoint_path: str) -> str:
    checkpoint = open_checkpoint(checkpoint_path)
    total_seconds = int(checkpoint._metadata.timestep.total_seconds())
    hours, remainder = divmod(total_seconds, 3600)
    if remainder == 0:
        return f"{hours}h"
    minutes = remainder // 60
    return f"{hours}h{minutes}m" if hours else f"{minutes}m"


def generate_artifact_entry(
    checkpoint_path: str,
    url: str = "FILL_ME",
    display_name: str = "FILL_ME",
    display_author: str = "FILL_ME",
    display_description: str = "FILL_ME",
    comment: str = "",
    minimum_gpu_memory_mib: int | None = None,
    supported_platforms: str = "linux,macos",
    input_characteristics: str = "",
) -> None:
    """Generate a serialised AnemoiCheckpoint artifact entry from a checkpoint file.

    Args:
        checkpoint_path: Path to the .ckpt file.
        url: Source URL for the checkpoint (e.g. hugging face or catalogue URL).
        display_name: Human-readable name shown in the frontend.
        display_author: Author shown in the frontend.
        display_description: Description shown in the frontend.
        comment: Optional internal comment.
        minimum_gpu_memory_mib: Minimum GPU memory in MiB if GPU is required.
        supported_platforms: Comma-separated list of platforms (linux,macos).
        input_characteristics: Comma-separated list of input characteristic keys.
    """
    import json

    qubes = get_qubes(checkpoint_path)

    # Build the fiab-core pydantic models rather than raw dicts: this validates the payload at
    # generation time and lets `ty` catch any drift from the schema before it lands in main.
    common = CommonArtifactMetadata(
        url=url,
        display_name=display_name,
        display_author=display_author,
        display_description=display_description,
        comment=comment,
        disk_size_bytes=get_bytes_on_disk(checkpoint_path),
        supported_platforms=parse_platforms(supported_platforms),
    )
    specific = AnemoiCheckpoint(
        minimum_gpu_memory_mib=minimum_gpu_memory_mib,
        pip_package_constraints=get_package_versions(checkpoint_path),
        input_characteristics=[c.strip() for c in input_characteristics.split(",") if c.strip()],
        input_qube=qubes["input_qube"],
        output_qube=qubes["output_qube"],
        extra_output_keys=extra_output_keys,
        timestep=get_timestep(checkpoint_path),
    )

    artifact_entry: dict[str, Any] = {
        "artifact_type": "AnemoiCheckpoint",
        "common": common.model_dump(),
        "specific": specific.model_dump(),
    }

    print(json.dumps(artifact_entry, indent=2))


if __name__ == "__main__":
    import fire  # ty: ignore[unresolved-import]

    fire.Fire(generate_artifact_entry)

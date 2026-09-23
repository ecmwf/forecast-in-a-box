import logging
import os
import platform
import re
import subprocess
from dataclasses import dataclass

from fiab_core.artifacts import AnemoiCheckpoint, CommonArtifactMetadata, Platform

logger = logging.getLogger(__name__)


@dataclass(frozen=True, eq=True, slots=True)
class PlatformInfo:
    """Platform Name and GPU memory (VRAM).
    - macOS: Returns total system memory (Unified Memory).
    - Linux (NVIDIA): Parses nvidia-smi for total VRAM.
    """

    platform_name: Platform | None
    gpu_memory_mib: int | None


def _linux_list_gpus() -> list[str]:
    output = subprocess.check_output(["nvidia-smi", "-L"], encoding="utf-8")
    return output.splitlines()


def _linux_query_gpu_memory() -> list[str]:
    cmd = ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,nounits,noheader"]
    output = subprocess.check_output(cmd, encoding="utf-8")
    return output.splitlines()


def _linux_total_memory() -> int:
    gpus = _linux_list_gpus()
    gpu_lines = [line for line in gpus if line.startswith("GPU ")]
    if not gpu_lines:
        return 0

    visible = os.environ.get("CUDA_VISIBLE_DEVICES")
    if visible == "":
        return 0

    partition_lines = [line for line in gpus if re.match(r"\s*MIG\b", line)]
    if partition_lines:
        gpu_memory: list[int] = []
        device_uuids: list[str | None] = []
        for line in partition_lines:
            match = re.search(r"\bMIG\s+\d+g\.(\d+(?:\.\d+)?)gb\b", line, re.IGNORECASE)
            if match is None:
                raise ValueError(f"Unable to parse GPU partition memory from nvidia-smi output: {line}")
            gpu_memory.append(int(float(match.group(1)) * 1024))
            uuid_match = re.search(r"\(UUID:\s*([^)]+)\)", line)
            device_uuids.append(uuid_match.group(1) if uuid_match is not None else None)

        return _sum_visible_gpu_memory(gpu_memory, visible, device_uuids)

    memory_output = _linux_query_gpu_memory()
    if any(value.strip().casefold() in {"n/a", "not supported"} for value in memory_output):
        logger.warning("assuming unified memory")
        with open("/proc/meminfo", encoding="utf-8") as meminfo:
            for line in meminfo:
                if line.startswith("MemTotal:"):
                    return int(line.split()[1]) // 1024
        raise ValueError("MemTotal was not found in /proc/meminfo")

    gpu_memory = [int(value.strip()) for value in memory_output]
    return _sum_visible_gpu_memory(gpu_memory, visible)


def _sum_visible_gpu_memory(gpu_memory: list[int], visible: str | None, device_uuids: list[str | None] | None = None) -> int:
    if visible is None:
        return sum(gpu_memory)

    selectors = [selector.strip() for selector in visible.split(",")]
    selected_memory = 0
    for index, memory in enumerate(gpu_memory):
        device_uuid = device_uuids[index] if device_uuids is not None else None
        if str(index) in selectors or (device_uuid is not None and device_uuid in selectors):
            selected_memory += memory
    return selected_memory


def _macos_total_memory() -> int:
    # sysctl reports bytes; convert to MiB.
    cmd = ["sysctl", "-n", "hw.memsize"]
    mem_bytes = int(subprocess.check_output(cmd).strip())
    return mem_bytes // (1024**2)


def get_platform_info() -> PlatformInfo | None:
    system = platform.system()

    if system == "Darwin":
        try:
            return PlatformInfo(platform_name="macos", gpu_memory_mib=_macos_total_memory())
        except Exception as e:
            logger.error(f"Error fetching macOS memory: {e}")
            return PlatformInfo(platform_name="macos", gpu_memory_mib=None)

    elif system == "Linux":
        try:
            gpu_memory_mib = _linux_total_memory()
            return PlatformInfo(platform_name="linux", gpu_memory_mib=gpu_memory_mib or None)
        except FileNotFoundError:
            logger.debug("nvidia-smi not found. Ensure NVIDIA drivers are installed.")
            return PlatformInfo(platform_name="linux", gpu_memory_mib=None)
        except Exception as e:
            logger.error(f"Error fetching NVIDIA memory: {e}")
            return PlatformInfo(platform_name="linux", gpu_memory_mib=None)
        # TODO support amd rocm, intel, etc

    else:
        logger.error(f"System {system} not explicitly supported!")
        return PlatformInfo(platform_name=None, gpu_memory_mib=None)


def get_model_checkpoint_compatibility(
    common: CommonArtifactMetadata, specific: AnemoiCheckpoint, platform_info: PlatformInfo | None
) -> tuple[bool, str | None]:
    errors = []
    if platform_info is None:
        errors.append("local PlatformInfo not detected")
    else:
        if platform_info.platform_name not in common.supported_platforms:
            errors.append(
                f"the local platform {platform_info.platform_name} is not supported by the model ({','.join(common.supported_platforms)})"
            )
        if specific.minimum_gpu_memory_mib is not None:
            if platform_info.gpu_memory_mib is None:
                errors.append(f"no gpu found, but the model requires one")
            else:
                if platform_info.gpu_memory_mib < specific.minimum_gpu_memory_mib:
                    errors.append(
                        f"found only {platform_info.gpu_memory_mib} MiB gpu memory, but model needs {specific.minimum_gpu_memory_mib}"
                    )
    if errors:
        return False, ";".join(errors)
    else:
        return True, None

import logging
import platform
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


def get_platform_info() -> PlatformInfo | None:
    system = platform.system()

    # --- macOS Logic (Unified Memory) ---
    if system == "Darwin":
        try:
            # sysctl reports bytes; we convert to MiB
            cmd = ["sysctl", "-n", "hw.memsize"]
            mem_bytes = int(subprocess.check_output(cmd).strip())
            return PlatformInfo(platform_name="macos", gpu_memory_mib=mem_bytes // (1024**2))
        except Exception as e:
            logger.error(f"Error fetching macOS memory: {e}")
            return PlatformInfo(platform_name="macos", gpu_memory_mib=None)

    # --- Linux Logic (NVIDIA VRAM) ---
    elif system == "Linux":
        try:
            # Query nvidia-smi specifically for memory.total
            # format=csv,nounits,noheader makes parsing trivial
            cmd = ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,nounits,noheader"]
            output = subprocess.check_output(cmd, encoding="utf-8").strip()

            # If multiple GPUs exist, this returns multiple lines
            gpu_memory_mib = sum([int(x) for x in output.split("\n")])
            return PlatformInfo(platform_name="linux", gpu_memory_mib=gpu_memory_mib)
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

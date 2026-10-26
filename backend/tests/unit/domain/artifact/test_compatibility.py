from io import StringIO
from unittest.mock import Mock

import pytest

from forecastbox.domain.artifact import compatibility
from forecastbox.domain.artifact.compatibility import PlatformInfo

_GPU_3070 = "GPU 0: NVIDIA GeForce RTX 3070 Laptop GPU (UUID: GPU-12345679-abcd-4905-a985-2bdd9950ad63)"
_GPU_H200 = "GPU 0: NVIDIA H200 NVL (UUID: GPU-12345679-abcd-4905-a985-2bdd9950ad63)"
_GPU_RTX_PRO = "GPU 0: NVIDIA RTX PRO 6000 Blackwell Server Edition (UUID: GPU-12345679-abcd-4905-a985-2bdd9950ad63)"


def test_linux_total_memory_uses_gpu_memory_query_for_unpartitioned_gpu(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CUDA_VISIBLE_DEVICES", raising=False)
    monkeypatch.setattr(compatibility, "_linux_list_gpus", lambda: [_GPU_3070])
    query_memory = Mock(return_value=["8192"])
    monkeypatch.setattr(compatibility, "_linux_query_gpu_memory", query_memory)

    assert compatibility._linux_total_memory() == 8192
    query_memory.assert_called_once_with()


def test_linux_total_memory_reads_one_partition_from_gpu_list(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CUDA_VISIBLE_DEVICES", raising=False)
    monkeypatch.setattr(
        compatibility,
        "_linux_list_gpus",
        lambda: [
            _GPU_H200,
            "  MIG 3g.71gb     Device  0: (UUID: MIG-12345679-abcd-4905-a985-2bdd9950ad63)",
        ],
    )
    query_memory = Mock()
    monkeypatch.setattr(compatibility, "_linux_query_gpu_memory", query_memory)

    assert compatibility._linux_total_memory() == 71 * 1024
    query_memory.assert_not_called()


def test_linux_total_memory_sums_multiple_partitions_from_gpu_list(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CUDA_VISIBLE_DEVICES", raising=False)
    monkeypatch.setattr(
        compatibility,
        "_linux_list_gpus",
        lambda: [
            _GPU_RTX_PRO,
            "  MIG 2g.48gb     Device  0: (UUID: MIG-12345679-abcd-4905-a985-2bdd9950ad63)",
            "  MIG 2g.48gb     Device  1: (UUID: MIG-12345679-abcd-4905-a985-2bdd9950ad63)",
        ],
    )
    monkeypatch.setattr(compatibility, "_linux_query_gpu_memory", Mock())

    assert compatibility._linux_total_memory() == 2 * 48 * 1024


def test_linux_total_memory_respects_visible_partition(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CUDA_VISIBLE_DEVICES", "1")
    monkeypatch.setattr(
        compatibility,
        "_linux_list_gpus",
        lambda: [
            _GPU_RTX_PRO,
            "  MIG 2g.48gb     Device  0: (UUID: MIG-12345679-abcd-4905-a985-2bdd9950ad63)",
            "  MIG 2g.48gb     Device  1: (UUID: MIG-12345679-abcd-4905-a985-2bdd9950ad63)",
        ],
    )
    monkeypatch.setattr(compatibility, "_linux_query_gpu_memory", Mock())

    assert compatibility._linux_total_memory() == 48 * 1024


def test_linux_total_memory_respects_visible_gpu(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CUDA_VISIBLE_DEVICES", "0")
    monkeypatch.setattr(
        compatibility,
        "_linux_list_gpus",
        lambda: [
            _GPU_3070,
            "GPU 1: NVIDIA GeForce RTX 3080 (UUID: GPU-22345679-abcd-4905-a985-2bdd9950ad63)",
        ],
    )
    monkeypatch.setattr(compatibility, "_linux_query_gpu_memory", lambda: ["8192", "16384"])

    assert compatibility._linux_total_memory() == 8192


@pytest.mark.parametrize("query_result", [["N/A"], ["Not Supported"]])
@pytest.mark.parametrize(
    ("meminfo_line", "expected_memory"),
    [("MemTotal:       16777216 kB", 16 * 1024), ("MemTotal:       16384 mB", 16 * 1024)],
)
def test_linux_total_memory_falls_back_to_system_memory_for_unified_memory(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    query_result: list[str],
    meminfo_line: str,
    expected_memory: int,
) -> None:
    monkeypatch.delenv("CUDA_VISIBLE_DEVICES", raising=False)
    monkeypatch.setattr(compatibility, "_linux_list_gpus", lambda: [_GPU_3070])
    monkeypatch.setattr(compatibility, "_linux_query_gpu_memory", lambda: query_result)
    monkeypatch.setattr("builtins.open", lambda *args, **kwargs: StringIO(f"{meminfo_line}\nMemFree:        1234 kB\n"))

    assert compatibility._linux_total_memory() == expected_memory
    assert "assuming unified memory" in caplog.text


def test_linux_total_memory_rejects_unparseable_meminfo_line(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CUDA_VISIBLE_DEVICES", raising=False)
    monkeypatch.setattr(compatibility, "_linux_list_gpus", lambda: [_GPU_3070])
    monkeypatch.setattr(compatibility, "_linux_query_gpu_memory", lambda: ["N/A"])
    malformed_line = "MemTotal: 12345 bytes"
    monkeypatch.setattr("builtins.open", lambda *args, **kwargs: StringIO(f"{malformed_line}\n"))

    with pytest.raises(ValueError, match=f"unparseable line: {malformed_line}"):
        compatibility._linux_total_memory()


def test_get_platform_info_uses_linux_total_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(compatibility.platform, "system", lambda: "Linux")
    monkeypatch.setattr(compatibility, "_linux_total_memory", lambda: 2048)
    macos_memory = Mock()
    monkeypatch.setattr(compatibility, "_macos_total_memory", macos_memory)

    assert compatibility.get_platform_info() == PlatformInfo(platform_name="linux", gpu_memory_mib=2048)
    macos_memory.assert_not_called()


def test_get_platform_info_uses_macos_total_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(compatibility.platform, "system", lambda: "Darwin")
    linux_memory = Mock()
    monkeypatch.setattr(compatibility, "_linux_total_memory", linux_memory)
    monkeypatch.setattr(compatibility, "_macos_total_memory", lambda: 16384)

    assert compatibility.get_platform_info() == PlatformInfo(platform_name="macos", gpu_memory_mib=16384)
    linux_memory.assert_not_called()


def test_get_platform_info_reports_no_gpu_when_linux_memory_is_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(compatibility.platform, "system", lambda: "Linux")
    monkeypatch.setattr(compatibility, "_linux_total_memory", lambda: 0)

    assert compatibility.get_platform_info() == PlatformInfo(platform_name="linux", gpu_memory_mib=None)

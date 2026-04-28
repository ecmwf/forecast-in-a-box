# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import pathlib
import struct
from unittest.mock import MagicMock, patch

import pytest
from fiab_core.artifacts import ArtifactsProvider, CompositeArtifactId
from fiab_core.fable import (
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    PluginBlockFactoryId,
    PluginCompositeId,
    PluginId,
    PluginStoreId,
    RawOutput,
)

from fiab_plugin_test import _get_checkpoint_enum_type, catalogue, compiler, validator
from fiab_plugin_test.runtime import sink_image, source_filesize

# ---------------------------------------------------------------------------
# runtime.source_filesize
# ---------------------------------------------------------------------------


def test_source_filesize_returns_correct_size(tmp_path: pathlib.Path) -> None:
    f = tmp_path / "artifact.bin"
    f.write_bytes(b"x" * 64)
    assert source_filesize(str(f)) == "64"


def test_source_filesize_returns_string_type(tmp_path: pathlib.Path) -> None:
    f = tmp_path / "artifact.bin"
    f.write_bytes(b"hello")
    result = source_filesize(str(f))
    assert isinstance(result, str)


def test_source_filesize_empty_file(tmp_path: pathlib.Path) -> None:
    f = tmp_path / "empty.bin"
    f.write_bytes(b"")
    assert source_filesize(str(f)) == "0"


def test_source_filesize_missing_file_raises(tmp_path: pathlib.Path) -> None:
    with pytest.raises(FileNotFoundError):
        source_filesize(str(tmp_path / "does_not_exist.bin"))


# ---------------------------------------------------------------------------
# _get_checkpoint_enum_type helper
# ---------------------------------------------------------------------------


def test_get_checkpoint_enum_type_returns_str_when_provider_unregistered() -> None:
    original = ArtifactsProvider._get_checkpoint_lookup
    ArtifactsProvider._get_checkpoint_lookup = None  # type: ignore[assignment]
    try:
        result = _get_checkpoint_enum_type()
    finally:
        ArtifactsProvider._get_checkpoint_lookup = original
    assert result == "str"


def test_get_checkpoint_enum_type_returns_str_when_no_checkpoints() -> None:
    with patch.object(ArtifactsProvider, "get_checkpoint_lookup", return_value={}):
        result = _get_checkpoint_enum_type()
    assert result == "str"


def test_get_checkpoint_enum_type_returns_enum_with_checkpoints() -> None:
    fake_id = CompositeArtifactId.from_str("mystore:mycheckpoint")
    with patch.object(ArtifactsProvider, "get_checkpoint_lookup", return_value={fake_id: MagicMock()}):
        result = _get_checkpoint_enum_type()
    assert result == "enum['mystore:mycheckpoint']"


# ---------------------------------------------------------------------------
# catalogue
# ---------------------------------------------------------------------------


def test_catalogue_contains_source_filesize() -> None:
    assert BlockFactoryId("source_filesize") in catalogue.factories


def test_source_filesize_factory_is_source_kind() -> None:
    factory = catalogue.factories[BlockFactoryId("source_filesize")]
    assert factory.kind == "source"


def test_source_filesize_factory_has_checkpoint_option() -> None:
    factory = catalogue.factories[BlockFactoryId("source_filesize")]
    assert "checkpoint" in factory.configuration_options


# ---------------------------------------------------------------------------
# validator
# ---------------------------------------------------------------------------

_FAKE_PLUGIN_ID = PluginCompositeId(store=PluginStoreId("s"), local=PluginId("l"))


def _make_instance(factory: str, config: dict) -> BlockInstance:
    return BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=_FAKE_PLUGIN_ID, factory=BlockFactoryId(factory)),
        configuration_values=config,
        input_ids={},
    )


def test_validator_source_filesize_returns_str_raw_output() -> None:
    instance = _make_instance("source_filesize", {"checkpoint": "mystore:mycheckpoint"})
    result = validator(instance, {})
    assert result.t is not None
    assert isinstance(result.t, RawOutput)
    assert result.t.type_fqn == "str"


# ---------------------------------------------------------------------------
# compiler
# ---------------------------------------------------------------------------


def test_compiler_source_filesize_embeds_path_and_artifact_in_payload(tmp_path: pathlib.Path) -> None:
    artifact_path = tmp_path / "checkpoint.bin"
    fake_id = CompositeArtifactId.from_str("mystore:mycheckpoint")

    with patch.object(ArtifactsProvider, "get_artifact_local_path", return_value=artifact_path):
        instance = _make_instance("source_filesize", {"checkpoint": "mystore:mycheckpoint"})
        result = compiler({}, BlockInstanceId("src"), instance)

    assert result.t is not None, f"compiler returned error: {result.e}"

    # Inspect the single source node in the returned action graph
    nodes = list(result.t.graph().nodes())
    assert len(nodes) == 1
    payload = nodes[0].payload
    assert payload.kwargs["path"] == str(artifact_path)
    assert fake_id in payload.metadata["artifacts"]


# ---------------------------------------------------------------------------
# sink_image (pre-existing tests kept here for completeness)
# ---------------------------------------------------------------------------


def test_ok() -> None:
    """Tests, as a minimum, that everything can be imported"""
    assert True


def test_sink_image_returns_valid_png() -> None:
    result, mime = sink_image(42)

    assert isinstance(result, bytes)
    assert len(result) > 0
    assert result[:8] == b"\x89PNG\r\n\x1a\n", "Missing PNG signature"

    # IHDR chunk starts at offset 8
    # layout: 4B length | 4B type | 13B data | 4B CRC
    assert result[8:12] == b"\x00\x00\x00\x0d", "IHDR length must be 13"
    assert result[12:16] == b"IHDR"
    width = struct.unpack(">I", result[16:20])[0]
    height = struct.unpack(">I", result[20:24])[0]
    bit_depth = result[24]
    color_type = result[25]

    assert width == 64
    assert height == 64
    assert bit_depth == 8
    assert color_type == 0  # grayscale

    assert b"IEND" in result, "PNG must contain IEND chunk"
    assert mime == "image/png"


def test_sink_image_modulo_256() -> None:
    """Values >= 256 are taken modulo 256."""
    result_low, _ = sink_image(42)
    result_high, _ = sink_image(42 + 256)
    assert result_low == result_high

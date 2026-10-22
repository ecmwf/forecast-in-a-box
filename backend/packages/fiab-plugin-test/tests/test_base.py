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
from cascade.low.func import Either
from earthkit.workflows.fluent import Action
from fiab_core.artifacts import ArtifactsProvider, CompositeArtifactId
from fiab_core.fable import (
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    ConfigurationOptionId,
    RawOutput,
    is_fetchable_mime,
)

from fiab_plugin_test import _get_checkpoint_enum_type, catalogue, compiler, validator
from fiab_plugin_test.runtime import DEFAULT_TEXT, sink_file, sink_filetree, sink_image, source_filesize, source_text

# ---------------------------------------------------------------------------
# runtime.source_text
# ---------------------------------------------------------------------------


def test_source_text_returns_input() -> None:
    assert source_text("hello") == "hello"
    assert source_text("") == ""


def test_source_text_imputes_default_on_none() -> None:
    assert source_text(None) == DEFAULT_TEXT


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
# catalogue
# ---------------------------------------------------------------------------


def test_catalogue_contains_source_filesize() -> None:
    assert BlockFactoryId("source_filesize") in catalogue().factories


def test_source_filesize_factory_is_source_kind() -> None:
    factory = catalogue().factories[BlockFactoryId("source_filesize")]
    assert factory.kind == "source"


def test_source_filesize_factory_has_checkpoint_option() -> None:
    factory = catalogue().factories[BlockFactoryId("source_filesize")]
    assert ConfigurationOptionId("checkpoint") in factory.configuration_options


def test_source_filesize_factory_uses_closed_enum_checkpoint_type() -> None:
    factory = catalogue().factories[BlockFactoryId("source_filesize")]
    assert (
        factory.configuration_options[ConfigurationOptionId("checkpoint")].value_type.serialize()
        == "enumClosed[artifact]('mystore:mycheckpoint')"
    )


# ---------------------------------------------------------------------------
# validator
# ---------------------------------------------------------------------------


def _make_instance(factory: str, config: dict) -> tuple[BlockFactoryId, BlockInstance]:
    return (
        BlockFactoryId(factory),
        BlockInstance(
            configuration_values={ConfigurationOptionId(key): value for key, value in config.items()},
            input_ids={},
        ),
    )


def test_validator_source_filesize_returns_str_raw_output() -> None:
    factory_id, instance = _make_instance("source_filesize", {"checkpoint": "mystore:mycheckpoint"})
    validation = validator(factory_id, instance, {})
    result = validation.result
    assert validation.restrictions == {}
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
        factory_id, instance = _make_instance("source_filesize", {"checkpoint": fake_id})
        result = compiler({}, factory_id, instance)

    assert result.t is not None, f"compiler returned error: {result.e}"

    # Inspect the single source node in the returned action graph
    nodes = list(result.t.graph().nodes())
    assert len(nodes) == 1
    payload = nodes[0].payload
    assert payload.static_input_kw["path"] == str(artifact_path)
    assert CompositeArtifactId.to_str(fake_id) in nodes[0].metadata.artifacts.artifact_urls


# ---------------------------------------------------------------------------
# sink_image (pre-existing tests kept here for completeness)
# ---------------------------------------------------------------------------


def test_ok() -> None:
    """Tests, as a minimum, that everything can be imported"""
    assert True


def test_sink_image_returns_valid_png() -> None:
    result = sink_image(42)

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


def test_sink_image_modulo_256() -> None:
    """Values >= 256 are taken modulo 256."""
    result_low = sink_image(42)
    result_high = sink_image(42 + 256)
    assert result_low == result_high


def test_sink_image_idx_shifts_value() -> None:
    """The task index shifts the grayscale value by 10 per index."""
    assert sink_image(42, idx=0) == sink_image(42)
    assert sink_image(42, idx=3) == sink_image(72)
    assert sink_image(42, idx=1) != sink_image(42)


def _compile_sink_image(images: object) -> Either[Action, str]:  # ty:ignore[invalid-type-arguments] # semigroup
    source = compiler({}, BlockFactoryId("source_42"), BlockInstance(configuration_values={}, input_ids={})).t
    assert source is not None
    instance = BlockInstance(
        configuration_values={ConfigurationOptionId("images"): images},
        input_ids={"data": BlockInstanceId("source")},
    )
    return compiler({BlockInstanceId("source"): source}, BlockFactoryId("sink_image"), instance)


def test_compiler_sink_image_single() -> None:
    result = _compile_sink_image(1)
    assert result.t is not None, f"compiler returned error: {result.e}"
    sinks = result.t.graph().sinks
    assert len(sinks) == 1
    assert sinks[0].payload.static_input_kw == {"idx": 0}
    assert sinks[0].metadata.builder.display_name == "Image #0"
    assert sinks[0].metadata.builder.dimension_kvs == [("idx", "0")]


def test_compiler_sink_image_multiple() -> None:
    result = _compile_sink_image(3)
    assert result.t is not None, f"compiler returned error: {result.e}"
    sinks = sorted(result.t.graph().sinks, key=lambda n: n.payload.static_input_kw["idx"])
    assert len(sinks) == 3
    assert len({n.name for n in sinks}) == 3
    for idx, node in enumerate(sinks):
        assert node.payload.static_input_kw == {"idx": idx}
        assert node.metadata.builder.display_name == f"Image #{idx}"
        assert node.metadata.builder.dimension_kvs == [("idx", str(idx))]


def test_compiler_sink_image_invalid_images() -> None:
    assert _compile_sink_image(0).e is not None
    assert _compile_sink_image("3").e is not None


def test_sink_file_returns_bytes_locator(tmp_path: pathlib.Path) -> None:
    locator = sink_file("hello", str(tmp_path / "out.txt"))
    assert isinstance(locator, bytes)
    assert locator.startswith(b"file://")


def test_sink_filetree_creates_nested_file(tmp_path: pathlib.Path) -> None:
    root = tmp_path / "tree"
    locator = sink_filetree(42, str(root), 3)
    assert locator == str(root.absolute()).encode("ascii")
    assert (root / "d1" / "d2" / "d3" / "file").read_text() == "42"


def test_sink_filetree_depth_zero(tmp_path: pathlib.Path) -> None:
    root = tmp_path / "tree"
    sink_filetree("x", str(root), 0)
    assert (root / "file").read_text() == "x"


def _compile_sink_filetree(path_root: object, depth: object) -> Either[Action, str]:  # ty:ignore[invalid-type-arguments] # semigroup
    source = compiler({}, BlockFactoryId("source_42"), BlockInstance(configuration_values={}, input_ids={})).t
    assert source is not None
    instance = BlockInstance(
        configuration_values={ConfigurationOptionId("path_root"): path_root, ConfigurationOptionId("depth"): depth},
        input_ids={"data": BlockInstanceId("source")},
    )
    return compiler({BlockInstanceId("source"): source}, BlockFactoryId("sink_filetree"), instance)


def test_compiler_sink_filetree() -> None:
    result = _compile_sink_filetree("/tmp/x", 2)
    assert result.t is not None, f"compiler returned error: {result.e}"
    sinks = result.t.graph().sinks
    assert len(sinks) == 1
    assert sinks[0].payload.static_input_kw == {"path_root": "/tmp/x", "depth": 2}


def test_compiler_sink_filetree_invalid() -> None:
    assert _compile_sink_filetree(1, 2).e is not None
    assert _compile_sink_filetree("/tmp/x", "2").e is not None
    assert _compile_sink_filetree("/tmp/x", -1).e is not None


def test_validator_sink_filetree_is_fetchable() -> None:
    validation = validator(BlockFactoryId("sink_filetree"), BlockInstance(configuration_values={}, input_ids={}), {})
    output = validation.result.t
    assert isinstance(output, RawOutput)
    assert is_fetchable_mime(output.mime_type)


# ---------------------------------------------------------------------------
# blueprint_templates
# ---------------------------------------------------------------------------


def test_plugin_has_testBasic_template() -> None:
    from fiab_plugin_test import plugin

    templates = plugin().blueprint_templates
    names = [t.display_name for t in templates]
    assert "testBasic" in names


def test_testBasic_template_display_name() -> None:
    from fiab_plugin_test import plugin

    tmpl = next(t for t in plugin().blueprint_templates if t.display_name == "testBasic")
    assert tmpl.display_name == "testBasic"

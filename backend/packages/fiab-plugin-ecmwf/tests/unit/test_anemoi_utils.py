# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the Anemoi input source variants."""

from collections.abc import Generator
from datetime import datetime
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fiab_core.artifacts import CompositeArtifactId
from fiab_core.types import OpenEnumType

from fiab_plugin_ecmwf.anemoi.blocks import AnemoiBuilder, AnemoiInputSource, AnemoiSource
from fiab_plugin_ecmwf.anemoi.utils import (
    INPUT_SOURCE_EXTRAS,
    CheckpointArtifact,
    _get_input_source_config,
    get_available_input_sources,
    get_input_source_extras,
)
from fiab_plugin_ecmwf.constants import INPUT_SOURCE

OPENDATA_EXTRA = "anemoi-plugins-ecmwf-inference[opendata]>=0.7.0"
OPENDATA_FULL_COMBINATIONS = [f"opendata:{source}:{resol}" for source in ("ecmwf", "google", "aws") for resol in ("highres", "lowres")]


class TestInputSourceExtras:
    def test_opendata_extras_contain_inference_plugin(self) -> None:
        assert OPENDATA_EXTRA in INPUT_SOURCE_EXTRAS["opendata"]

    def test_base_source(self) -> None:
        assert get_input_source_extras("opendata") == INPUT_SOURCE_EXTRAS["opendata"]
        assert OPENDATA_EXTRA in get_input_source_extras("opendata")

    def test_variant_uses_base_source_extras(self) -> None:
        assert get_input_source_extras("opendata:aws:highres") == get_input_source_extras("opendata")
        assert get_input_source_extras("polytope:test") == get_input_source_extras("polytope")

    def test_unknown_source(self) -> None:
        assert get_input_source_extras("custom") == []
        assert get_input_source_extras("custom:variant") == []


class TestAvailableInputSources:
    def test_includes_sources_without_variants(self) -> None:
        available = get_available_input_sources()
        for source in ("mars", "dummy"):
            assert source in available

    def test_excludes_bare_sources_with_variants(self) -> None:
        available = get_available_input_sources()
        for source in ("polytope", "opendata"):
            assert source not in available

    def test_includes_polytope_variants(self) -> None:
        available = get_available_input_sources()
        assert "polytope:test" in available
        assert "polytope:mars" in available

    def test_includes_all_opendata_full_combinations(self) -> None:
        available = get_available_input_sources()
        assert len(OPENDATA_FULL_COMBINATIONS) == 6
        for name in OPENDATA_FULL_COMBINATIONS:
            assert name in available

    def test_excludes_partial_combinations(self) -> None:
        available = get_available_input_sources()
        for name in ("opendata:ecmwf", "opendata:google", "opendata:aws", "opendata:highres", "opendata:lowres"):
            assert name not in available

    def test_no_duplicates(self) -> None:
        available = get_available_input_sources()
        assert len(available) == len(set(available))

    def test_every_entry_resolves(self) -> None:
        for name in get_available_input_sources():
            assert isinstance(_get_input_source_config(name), dict)


class TestGetInputSourceConfig:
    def test_plain_opendata(self) -> None:
        assert _get_input_source_config("opendata") == {}

    def test_partial_opendata(self) -> None:
        assert _get_input_source_config("opendata:google") == {"source": "google"}

    def test_full_opendata(self) -> None:
        assert _get_input_source_config("opendata:aws:lowres") == {"source": "aws", "resol": "0p25"}
        assert _get_input_source_config("opendata:ecmwf:highres") == {"source": "ecmwf", "resol": "0p1"}

    def test_plain_polytope_default(self) -> None:
        assert _get_input_source_config("polytope") == {"collection": "ecmwf-mars"}

    def test_polytope_variant_overrides_default(self) -> None:
        assert _get_input_source_config("polytope:test") == {"collection": "ecmwf-test"}
        assert _get_input_source_config("polytope:mars") == {"collection": "ecmwf-mars"}

    @pytest.mark.parametrize("name", ["custom", "mars", "dummy", "mars:foo", "custom:foo:bar"])
    def test_sources_without_variants(self, name: str) -> None:
        assert _get_input_source_config(name) == {}

    def test_unknown_variant_at_position(self) -> None:
        with pytest.raises(ValueError, match=r"(?s)Unknown variant 'highres'.*ecmwf.*google.*aws"):
            _get_input_source_config("opendata:highres")

    def test_unknown_variant_in_second_position(self) -> None:
        with pytest.raises(ValueError, match=r"(?s)Unknown variant 'google'.*highres.*lowres"):
            _get_input_source_config("opendata:google:google")

    def test_surplus_variant(self) -> None:
        with pytest.raises(ValueError, match="Unexpected variant 'extra'.*no further variants"):
            _get_input_source_config("polytope:mars:extra")


@pytest.fixture
def checkpoint_artifact(dummy_checkpoint: CompositeArtifactId) -> Generator[CheckpointArtifact, None, None]:
    """A CheckpointArtifact whose checkpoint has no input options."""
    mocked_checkpoint = MagicMock()
    mocked_checkpoint.configuration.input_options = None
    with patch.object(CheckpointArtifact, "checkpoint", return_value=mocked_checkpoint):
        yield CheckpointArtifact(dummy_checkpoint)


class TestGetInputConfiguration:
    def test_string_variant(self, checkpoint_artifact: CheckpointArtifact) -> None:
        result = checkpoint_artifact.get_input_configuration("opendata:google:highres")
        assert result == {"opendata": {"source": "google", "resol": "0p1"}}

    def test_plain_polytope_default(self, checkpoint_artifact: CheckpointArtifact) -> None:
        assert checkpoint_artifact.get_input_configuration("polytope") == {"polytope": {"collection": "ecmwf-mars"}}

    def test_plain_source_without_config(self, checkpoint_artifact: CheckpointArtifact) -> None:
        assert checkpoint_artifact.get_input_configuration("mars") == {"mars": {}}

    def test_dict_source_is_merged_and_not_mutated(self, checkpoint_artifact: CheckpointArtifact) -> None:
        source: dict[str, Any] = {"opendata:aws": {"foo": 1}}
        result = checkpoint_artifact.get_input_configuration(source)
        assert result == {"opendata": {"foo": 1, "source": "aws"}}
        assert source == {"opendata:aws": {"foo": 1}}

    def test_bad_variant(self, checkpoint_artifact: CheckpointArtifact) -> None:
        with pytest.raises(ValueError, match="highres"):
            checkpoint_artifact.get_input_configuration("opendata:highres")

    def test_surplus_variant(self, checkpoint_artifact: CheckpointArtifact) -> None:
        with pytest.raises(ValueError, match="no further variants"):
            checkpoint_artifact.get_input_configuration({"polytope:mars:extra": {}})


class TestInputSourceOption:
    @pytest.mark.parametrize("block", [AnemoiSource, AnemoiInputSource])
    def test_option_lists_variants(self, block: type[AnemoiSource] | type[AnemoiInputSource]) -> None:
        value_type = block.configuration_options[INPUT_SOURCE].value_type
        assert isinstance(value_type, OpenEnumType)
        for name in ("mars", "dummy", "polytope:test", "opendata:google:highres"):
            assert name in value_type.items
        for name in ("opendata", "polytope"):
            assert name not in value_type.items
        assert value_type.items == get_available_input_sources()


@pytest.fixture
def builder(dummy_checkpoint: CompositeArtifactId) -> Generator[AnemoiBuilder, None, None]:
    """An AnemoiBuilder with the checkpoint and artifact lookups mocked."""
    mocked_checkpoint = MagicMock()
    mocked_checkpoint.configuration.input_options = None
    with (
        patch.object(CheckpointArtifact, "checkpoint", return_value=mocked_checkpoint),
        patch.object(CheckpointArtifact, "get_environment", return_value=["base-package"]),
        patch.object(CheckpointArtifact, "get_url", return_value="http://example.com/ckpt"),
        patch.object(CheckpointArtifact, "get_local_path", return_value=Path("/local/ckpt")),
        patch.object(CheckpointArtifact, "get_additional_kwargs", return_value={}),
    ):
        yield AnemoiBuilder(dummy_checkpoint)


class TestAnemoiBuilderInputSource:
    def test_from_input_forwards_resolved_input_and_extras(self, builder: AnemoiBuilder) -> None:
        inference = MagicMock()
        with (
            patch.object(builder, "inference", return_value=inference) as mocked_inference,
            patch.object(builder, "_add_extra_output_keys", side_effect=lambda action: action),
        ):
            builder.from_input(input_source="opendata:google:highres", date=datetime(2024, 1, 1), lead_time=24)

        mocked_inference.assert_called_once()
        assert mocked_inference.call_args.kwargs["lead_time"] == 24
        assert mocked_inference.call_args.kwargs["extra_environment"] == INPUT_SOURCE_EXTRAS["opendata"]
        assert OPENDATA_EXTRA in mocked_inference.call_args.kwargs["extra_environment"]
        inference.from_input.assert_called_once()
        assert inference.from_input.call_args.kwargs["input"] == {"opendata": {"source": "google", "resol": "0p1"}}

    def test_get_initial_conditions_forwards_resolved_input_and_extras(self, builder: AnemoiBuilder) -> None:
        with patch("fiab_plugin_ecmwf.anemoi.blocks.get_initial_conditions") as mocked_get_initial_conditions:
            builder.get_initial_conditions(input_source="opendata:google:highres", date=datetime(2024, 1, 1))

        mocked_get_initial_conditions.assert_called_once()
        kwargs = mocked_get_initial_conditions.call_args.kwargs
        assert kwargs["input"] == {"opendata": {"source": "google", "resol": "0p1"}}
        assert kwargs["environment"] == ["base-package", *INPUT_SOURCE_EXTRAS["opendata"]]
        assert OPENDATA_EXTRA in kwargs["environment"]

# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import contextlib
from collections.abc import Generator
from pathlib import Path

import pytest
from fiab_core.artifacts import ArtifactsProvider, CompositeArtifactId, MlModelCheckpoint


@contextlib.contextmanager
def dummy_provider() -> Generator[None, None, None]:
    ArtifactsProvider.register_get_checkpoint_lookup(
        lambda: {
            CompositeArtifactId.from_str("dummy_store:dummy_ckpt"): MlModelCheckpoint(
                url="http://example.com/dummy_checkpoint",
                display_name="Dummy Checkpoint",
                display_author="Author",
                display_description="A dummy checkpoint for testing",
                disk_size_bytes=1234,
                pip_package_constraints=[],
                supported_platforms=["linux"],
                input_characteristics=[],
                output_qube={},
                timestep="1h",
                comment="A dummy comment",
            )
        }
    )
    ArtifactsProvider.register_get_artifact_local_path(
        lambda composite_id: Path(f"/local/path/for/{CompositeArtifactId.to_str(composite_id)}")
    )
    yield
    ArtifactsProvider._get_checkpoint_lookup = None
    ArtifactsProvider._get_artifact_local_path = None


@pytest.fixture
def registered_provider() -> Generator[None, None, None]:
    """Pytest fixture that registers the dummy ArtifactsProvider for the duration of a test."""
    with dummy_provider():
        yield


with dummy_provider():  # Configure the fiab_plugin_ecmwf.blocks module to use the dummy provider for testing
    from fiab_plugin_ecmwf import blocks

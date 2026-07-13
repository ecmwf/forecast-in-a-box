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
from fiab_core.artifacts import AnemoiCheckpoint, ArtifactResolved, ArtifactsProvider, CommonArtifactMetadata, CompositeArtifactId
from qubed import Qube

DUMMY_QUBE = Qube.from_json(
    {
        "key": "root",
        "values": {"type": "enum", "dtype": "str", "values": ("root",)},
        "metadata": {},
        "children": [
            {
                "key": "levtype",
                "values": {"type": "enum", "dtype": "str", "values": ("sfc",)},
                "metadata": {"name": {"shape": (1, 1, 1), "dtype": "str", "values": ["surface"]}},
                "children": [
                    {"key": "param", "values": {"type": "enum", "dtype": "str", "values": ("2t", "msl")}, "metadata": {}, "children": []}
                ],
            }
        ],
    }
)


@contextlib.contextmanager
def dummy_provider(*, timestep: str = "1h") -> Generator[None, None, None]:
    previous_get_artifacts_lookup = ArtifactsProvider._get_artifacts_lookup
    previous_get_artifact_local_path = ArtifactsProvider._get_artifact_local_path
    ArtifactsProvider.register_get_artifacts_lookup(
        lambda: {
            CompositeArtifactId.from_str("dummy_store:dummy_ckpt"): ArtifactResolved(
                artifact_type="AnemoiCheckpoint",
                common=CommonArtifactMetadata(
                    url="http://example.com/dummy_checkpoint",
                    display_name="Dummy Checkpoint",
                    display_author="Author",
                    display_description="A dummy checkpoint for testing",
                    disk_size_bytes=1234,
                    supported_platforms=["linux"],
                    comment="A dummy comment",
                ),
                specific=AnemoiCheckpoint(
                    pip_package_constraints=[],
                    input_characteristics=[],
                    input_qube=DUMMY_QUBE.to_json(),
                    output_qube=DUMMY_QUBE.to_json(),
                    timestep=timestep,
                ),
                is_locally_compatible=True,
                local_compatibility_detail=None,
            )
        }
    )
    ArtifactsProvider.register_get_artifact_local_path(
        lambda composite_id: Path(f"/local/path/for/{CompositeArtifactId.to_str(composite_id)}")
    )
    try:
        yield
    finally:
        ArtifactsProvider._get_artifacts_lookup = previous_get_artifacts_lookup
        ArtifactsProvider._get_artifact_local_path = previous_get_artifact_local_path


@pytest.fixture(scope="module", autouse=True)
def registered_provider() -> Generator[None, None, None]:
    """Pytest fixture that registers the dummy ArtifactsProvider for the duration of a test."""
    with dummy_provider():
        yield


@pytest.fixture(scope="module")
def dummy_checkpoint() -> str:
    return "dummy_store:dummy_ckpt"


@pytest.fixture
def six_hour_dummy_checkpoint() -> Generator[str, None, None]:
    with dummy_provider(timestep="6h"):
        yield "dummy_store:dummy_ckpt"


@pytest.fixture(scope="module")
def dummy_qube() -> Qube:
    """Pytest fixture that provides the dummy qube for testing."""
    return DUMMY_QUBE

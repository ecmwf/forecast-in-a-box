# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from typing import Iterator

import pytest
from fiab_core.artifacts import AnemoiCheckpoint, ArtifactLocalId, ArtifactResolved, ArtifactStoreId, CommonArtifactMetadata
from pyrsistent import pmap

from forecastbox.domain.artifact.base import CompositeArtifactId
from forecastbox.domain.artifact.manager import ArtifactManager
from forecastbox.domain.blueprint.display import ResolvableValue, configOption2display

# 2t -- 2 metre temperature, known to Metkit's ParamDB.
KNOWN_PARAM_ID = "167"
UNKNOWN_PARAM_ID = "999999999"


def _sample_artifact(display_name: str) -> ArtifactResolved:
    common = CommonArtifactMetadata(
        url="https://example.com/model.ckpt",
        display_name=display_name,
        display_author="Test Author",
        display_description="Test Description",
        disk_size_bytes=1024,
        supported_platforms=["linux", "macos"],
    )
    checkpoint = AnemoiCheckpoint(
        pip_package_constraints=[],
        input_characteristics=[],
        input_qube={},
        output_qube={},
        timestep="1h",
    )
    return ArtifactResolved(
        artifact_type="AnemoiCheckpoint",
        common=common,
        specific=checkpoint,
        is_locally_compatible=True,
        local_compatibility_detail=None,
    )


@pytest.fixture(autouse=True)
def _reset_artifact_catalog() -> Iterator[None]:
    original = ArtifactManager.catalog
    yield
    ArtifactManager.catalog = original


def test_artifact_found(monkeypatch: pytest.MonkeyPatch) -> None:
    composite_id = CompositeArtifactId(artifact_store_id=ArtifactStoreId("store"), artifact_local_id=ArtifactLocalId("model"))
    ArtifactManager.catalog = pmap({composite_id: _sample_artifact("My Model")})
    result = configOption2display([ResolvableValue(typeName="artifact", value="store:model")])
    assert result == ["My Model"]


def test_artifact_not_found() -> None:
    ArtifactManager.catalog = pmap()
    result = configOption2display([ResolvableValue(typeName="artifact", value="store:missing")])
    assert result == [None]


def test_artifact_malformed_value() -> None:
    ArtifactManager.catalog = pmap()
    result = configOption2display([ResolvableValue(typeName="artifact", value="not-a-composite-id")])
    assert result == [None]


def test_parameter_known() -> None:
    result = configOption2display([ResolvableValue(typeName="param", value=KNOWN_PARAM_ID)])
    assert result == ["2 metre temperature [K] (2t)"]


def test_parameter_unknown() -> None:
    result = configOption2display([ResolvableValue(typeName="param", value=UNKNOWN_PARAM_ID)])
    assert result == [None]


def test_parameter_non_numeric_value() -> None:
    result = configOption2display([ResolvableValue(typeName="param", value="2t")])
    assert result == [None]


def test_other_valid_type_returns_none() -> None:
    result = configOption2display([ResolvableValue(typeName="str", value="hello")])
    assert result == [None]

    result = configOption2display([ResolvableValue(typeName="int", value="42")])
    assert result == [None]


def test_invalid_type_raises() -> None:
    with pytest.raises(ValueError):
        configOption2display([ResolvableValue(typeName="not-a-real-type", value="x")])


def test_multiple_elements_preserve_order(monkeypatch: pytest.MonkeyPatch) -> None:
    composite_id = CompositeArtifactId(artifact_store_id=ArtifactStoreId("store"), artifact_local_id=ArtifactLocalId("model"))
    ArtifactManager.catalog = pmap({composite_id: _sample_artifact("My Model")})
    result = configOption2display(
        [
            ResolvableValue(typeName="artifact", value="store:model"),
            ResolvableValue(typeName="param", value=KNOWN_PARAM_ID),
            ResolvableValue(typeName="str", value="hello"),
        ]
    )
    assert result == ["My Model", "2 metre temperature [K] (2t)", None]

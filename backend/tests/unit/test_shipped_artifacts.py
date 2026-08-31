# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Validity of the artifact catalogue shipped in ``install/artifacts.json``.

The catalogue is hand-maintained data, and a bad entry is only noticed when a user
runs that model -- so the invariants the runtime relies on are asserted here instead.
"""

import json
from pathlib import Path
from typing import Any

import pytest
from fiab_core.artifacts import AnemoiCheckpoint, CommonArtifactMetadata

CATALOGUE_PATH = Path(__file__).parents[3] / "install" / "artifacts.json"


def _catalogue() -> dict[str, Any]:
    return json.loads(CATALOGUE_PATH.read_text())


def _artifact_ids() -> list[str]:
    return sorted(_catalogue()["artifacts"])


@pytest.fixture(scope="module")
def artifacts() -> dict[str, Any]:
    return _catalogue()["artifacts"]


@pytest.mark.parametrize("artifact_id", _artifact_ids())
def test_artifact_parses(artifacts: dict[str, Any], artifact_id: str) -> None:
    """Every entry must satisfy the models the backend parses it with."""
    entry = artifacts[artifact_id]
    CommonArtifactMetadata(**entry["common"])
    assert entry["artifact_type"] == "AnemoiCheckpoint", entry["artifact_type"]
    AnemoiCheckpoint(**entry["specific"])


@pytest.mark.parametrize("artifact_id", _artifact_ids())
def test_nested_model_region_of_interest(artifacts: dict[str, Any], artifact_id: str) -> None:
    """A nested model's region of interest must name one of its cutout sub-inputs.

    ``CheckpointArtifact.get_additional_kwargs`` turns the region of interest into an
    ``extract_from_state`` post processor, which looks the name up among the cutout masks --
    keyed by the ``input_options`` region names. A mismatch fails the run at compile time.
    """
    configuration = AnemoiCheckpoint(**artifacts[artifact_id]["specific"]).configuration
    if not configuration.nested_model:
        return

    assert configuration.region_of_interest is not None, "nested models must specify a region of interest"
    assert isinstance(configuration.input_options, list), "nested models must specify input options as a list"

    regions = [next(iter(region)) for region in configuration.input_options]
    assert configuration.region_of_interest in regions

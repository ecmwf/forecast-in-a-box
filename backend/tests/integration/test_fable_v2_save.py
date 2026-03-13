# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Integration tests for the v2 fable save/retrieve endpoints."""

from fiab_core.fable import BlockInstance, PluginBlockFactoryId, PluginCompositeId

from forecastbox.api.types.fable import FableBuilderV1, FableSaveV2Request
from forecastbox.api.types.jobs import EnvironmentSpecification


def _make_builder() -> FableBuilderV1:
    plugin_id = PluginCompositeId(store="ecmwf", local="ecmwf-base")
    source = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=plugin_id, factory="ekdSource"),
        configuration_values={"source": "ecmwf-open-data", "date": "2026-01-01", "expver": "0001"},
        input_ids={},
    )
    return FableBuilderV1(blocks={"source1": source})


def test_fable_v2_save_and_retrieve(backend_client_with_auth):
    builder = _make_builder()
    builder.environment = EnvironmentSpecification(hosts=2, workers_per_host=4)
    payload = FableSaveV2Request(
        builder=builder,
        display_name="Test Fable",
        display_description="A fable saved via the v2 API",
        tags=["test", "integration"],
    )

    # Save new definition
    response = backend_client_with_auth.post("/fable/upsert_v2", json=payload.model_dump())
    assert response.is_success, response.text
    saved = response.json()
    assert "id" in saved
    assert saved["version"] == 1
    fable_id = saved["id"]

    # Retrieve by id (latest version)
    response = backend_client_with_auth.get("/fable/retrieve_v2", params={"fable_id": fable_id})
    assert response.is_success, response.text
    retrieved = response.json()
    assert retrieved["id"] == fable_id
    assert retrieved["version"] == 1
    assert retrieved["display_name"] == "Test Fable"
    assert retrieved["tags"] == ["test", "integration"]
    assert retrieved["builder"]["blocks"]["source1"]["factory_id"]["factory"] == "ekdSource"
    assert retrieved["builder"]["environment"]["hosts"] == 2
    assert retrieved["builder"]["environment"]["workers_per_host"] == 4

    # Saving again with the same id creates a new version
    payload2 = FableSaveV2Request(builder=_make_builder(), display_name="Test Fable v2")
    response = backend_client_with_auth.post("/fable/upsert_v2", params={"fable_id": fable_id}, json=payload2.model_dump())
    assert response.is_success, response.text
    saved2 = response.json()
    assert saved2["id"] == fable_id
    assert saved2["version"] == 2

    # Retrieve latest returns version 2
    response = backend_client_with_auth.get("/fable/retrieve_v2", params={"fable_id": fable_id})
    assert response.is_success, response.text
    latest = response.json()
    assert latest["version"] == 2
    assert latest["display_name"] == "Test Fable v2"
    assert latest["builder"]["environment"] is None

    # Retrieve specific version 1 still works
    response = backend_client_with_auth.get("/fable/retrieve_v2", params={"fable_id": fable_id, "version": 1})
    assert response.is_success, response.text
    assert response.json()["version"] == 1
    assert response.json()["display_name"] == "Test Fable"


def test_fable_v2_retrieve_nonexistent(backend_client_with_auth):
    response = backend_client_with_auth.get("/fable/retrieve_v2", params={"fable_id": "does-not-exist"})
    assert response.status_code == 404


def test_fable_v2_upsert_nonexistent_id(backend_client_with_auth):
    """Attempting to add a version to a non-existent id returns 404."""
    builder = _make_builder()
    payload = FableSaveV2Request(builder=builder)
    response = backend_client_with_auth.post("/fable/upsert_v2", params={"fable_id": "no-such-id"}, json=payload.model_dump())
    assert response.status_code == 404


def test_fable_v2_existing_upsert_retrieve_unaffected(backend_client_with_auth):
    """Legacy /upsert and /retrieve endpoints still work alongside v2 endpoints."""
    builder = _make_builder()
    # FastAPI wraps the builder in {"builder": ...} because `tags: list[str]` is also a body param
    response = backend_client_with_auth.post("/fable/upsert", json={"builder": builder.model_dump()})
    assert response.is_success, response.text
    old_id = response.json()

    response = backend_client_with_auth.get("/fable/retrieve", params={"fable_builder_id": old_id})
    assert response.is_success, response.text
    assert response.json()["blocks"]["source1"]["factory_id"]["factory"] == "ekdSource"

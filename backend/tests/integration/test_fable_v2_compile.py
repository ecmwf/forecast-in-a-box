# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Integration tests for the v2 fable compile endpoint."""

from fiab_core.fable import BlockInstance, PluginBlockFactoryId, PluginCompositeId

from forecastbox.api.types.fable import FableBuilderV1, FableSaveV2Request


def _make_compilable_builder(tmpdir: str) -> FableBuilderV1:
    plugin_id = PluginCompositeId(store="ecmwf", local="ecmwf-base")
    source = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=plugin_id, factory="ekdSource"),
        configuration_values={"source": "ecmwf-open-data", "date": "2026-01-01", "expver": "0001"},
        input_ids={},
    )
    temporal_mean = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=plugin_id, factory="temporalStatistics"),
        configuration_values={"variable": "2t", "statistic": "mean"},
        input_ids={"dataset": "source1"},
    )
    ensemble_mean = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=plugin_id, factory="ensembleStatistics"),
        configuration_values={"variable": "2t", "statistic": "mean"},
        input_ids={"dataset": "temporalMean"},
    )
    sink = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=plugin_id, factory="zarrSink"),
        configuration_values={"path": f"{tmpdir}/output.zarr"},
        input_ids={"dataset": "ensembleMean"},
    )
    return FableBuilderV1(
        blocks={
            "source1": source,
            "temporalMean": temporal_mean,
            "ensembleMean": ensemble_mean,
            "sinkMean": sink,
        }
    )


def test_fable_v2_compile_latest_version(tmpdir, backend_client_with_auth):
    """A builder saved via upsert_v2 can be compiled by reference (no version = latest)."""
    builder = _make_compilable_builder(str(tmpdir))
    payload = FableSaveV2Request(builder=builder, display_name="Compile Test")
    save_resp = backend_client_with_auth.post("/fable/upsert_v2", json=payload.model_dump())
    assert save_resp.is_success, save_resp.text
    fable_id = save_resp.json()["id"]

    compile_resp = backend_client_with_auth.put("/fable/compile_v2", json={"id": fable_id})
    assert compile_resp.is_success, compile_resp.text
    spec = compile_resp.json()
    assert "job" in spec
    assert "environment" in spec
    assert len(spec["job"]["job_instance"]["tasks"]) > 0


def test_fable_v2_compile_specific_version(tmpdir, backend_client_with_auth):
    """Omitting version resolves to latest; specifying version compiles that exact version."""
    builder_v1 = _make_compilable_builder(str(tmpdir.mkdir("v1")))
    payload_v1 = FableSaveV2Request(builder=builder_v1, display_name="Version Test v1")
    save_resp = backend_client_with_auth.post("/fable/upsert_v2", json=payload_v1.model_dump())
    assert save_resp.is_success, save_resp.text
    fable_id = save_resp.json()["id"]

    # Save a second version with a different builder (source-only, no sink)
    plugin_id = PluginCompositeId(store="ecmwf", local="ecmwf-base")
    source_only = FableBuilderV1(
        blocks={
            "source1": BlockInstance(
                factory_id=PluginBlockFactoryId(plugin=plugin_id, factory="ekdSource"),
                configuration_values={"source": "ecmwf-open-data", "date": "2026-01-01", "expver": "0001"},
                input_ids={},
            )
        }
    )
    payload_v2 = FableSaveV2Request(builder=source_only, display_name="Version Test v2")
    save_resp2 = backend_client_with_auth.post(
        "/fable/upsert_v2", params={"fable_id": fable_id}, json=payload_v2.model_dump()
    )
    assert save_resp2.is_success, save_resp2.text
    assert save_resp2.json()["version"] == 2

    # Compile v1 explicitly — should produce tasks (has a sink)
    resp_v1 = backend_client_with_auth.put("/fable/compile_v2", json={"id": fable_id, "version": 1})
    assert resp_v1.is_success, resp_v1.text
    assert len(resp_v1.json()["job"]["job_instance"]["tasks"]) > 0

    # Compile latest (v2, source-only, no sink) — produces empty tasks
    resp_latest = backend_client_with_auth.put("/fable/compile_v2", json={"id": fable_id})
    assert resp_latest.is_success, resp_latest.text
    assert len(resp_latest.json()["job"]["job_instance"]["tasks"]) == 0


def test_fable_v2_compile_nonexistent(backend_client_with_auth):
    """Compiling an unknown fable id returns 404."""
    resp = backend_client_with_auth.put("/fable/compile_v2", json={"id": "does-not-exist"})
    assert resp.status_code == 404

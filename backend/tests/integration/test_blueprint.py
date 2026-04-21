# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Integration tests for the v2 blueprint and job endpoints.

There are two very important tests:
 - test_blueprint_expand -- the interactive building which UI does
 - test_blueprint_basic_execute -- an actual execution
Those two must be preserved under any refactoring, and their failure is always
suspicious. The remaining ones test edge cases and funcionality which is
possibly subject of changes, and their failure may be a legitimate behavioral
change (such as change of return error code).
"""

import io
import os
import pathlib
import sys
import zipfile
from datetime import datetime as _dt
from typing import Any, get_args

import cloudpickle
import httpx
import pytest
from fiab_core.fable import BlockFactoryId, BlockInstance, BlockInstanceId, PluginBlockFactoryId, PluginCompositeId

from forecastbox.domain.blueprint.cascade import EnvironmentSpecification
from forecastbox.domain.blueprint.service import BlueprintBuilder, BlueprintSaveCommand
from forecastbox.domain.glyphs.intrinsic import AvailableIntrinsicGlyphs
from forecastbox.routes.run import RunCreateResponse

from .conftest import testPluginId
from .utils import compare_with_tolerance, retry_until


def ensure_completed_v2(backend_client: httpx.Client, job_id: str, sleep: float = 0.5, attempts: int = 20) -> None:
    def do_action() -> Any:
        response = backend_client.get("/run/get", params={"run_id": job_id}, timeout=10)
        assert response.is_success, response.text
        return response.json()

    def verify_ok(data: Any) -> bool | None:
        if data["status"] == "failed":
            raise RuntimeError(f"Job {job_id} failed: {data}")
        assert data["status"] in {"submitted", "preparing", "running", "completed"}, data["status"]
        return True if data["status"] == "completed" else None

    retry_until(do_action, verify_ok, attempts=attempts, sleep=sleep, error_msg=f"Failed to finish job {job_id}")


def _make_builder_source_only() -> BlueprintBuilder:
    source_42 = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("source_42")),
        configuration_values={},
        input_ids={},
    )
    return BlueprintBuilder(blocks={BlockInstanceId("source_42"): source_42})


def _make_builder_full(tmpdir: str) -> BlueprintBuilder:
    source_42 = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("source_42")),
        configuration_values={},
        input_ids={},
    )
    transform_increment = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("transform_increment")),
        configuration_values={"amount": "1"},
        input_ids={"a": BlockInstanceId("source_42")},
    )
    product_join = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("product_join")),
        configuration_values={},
        input_ids={"a": BlockInstanceId("transform_increment"), "b": BlockInstanceId("source_42")},
    )
    sink_main = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("sink_file")),
        configuration_values={"fname": f"{tmpdir}/output${{runId}}.main.txt"},
        input_ids={"data": BlockInstanceId("product_join")},
    )
    source_time = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("source_text")),
        configuration_values={"text": "${submitDatetime};${startDatetime};${basicExecuteGlobalGlyph};${blueprintExecuteLocalGlyph}"},
        input_ids={},
    )
    sink_time = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("sink_file")),
        configuration_values={"fname": f"{tmpdir}/output${{runId}}.time.txt"},
        input_ids={"data": BlockInstanceId("source_time")},
    )
    return BlueprintBuilder(
        blocks={
            BlockInstanceId("source_42"): source_42,
            BlockInstanceId("transform_increment"): transform_increment,
            BlockInstanceId("product_join"): product_join,
            BlockInstanceId("sink_main"): sink_main,
            BlockInstanceId("source_time"): source_time,
            BlockInstanceId("sink_time"): sink_time,
        },
        local_glyphs={"blueprintExecuteLocalGlyph": "local_glyph_value"},
    )


def test_blueprint_save_and_retrieve(backend_client_with_auth: httpx.Client) -> None:
    builder = _make_builder_source_only()
    builder.environment = EnvironmentSpecification(hosts=2, workers_per_host=4)
    payload = BlueprintSaveCommand(
        builder=builder,
        display_name="Test Blueprint",
        display_description="A blueprint saved via the v2 API",
        tags=["test", "integration"],
    )

    # Save new blueprint
    response = backend_client_with_auth.post("/blueprint/create", json=payload.model_dump())
    assert response.is_success, response.text
    saved = response.json()
    assert "blueprint_id" in saved
    assert saved["version"] == 1

    # Retrieve by id (latest version)
    response = backend_client_with_auth.get("/blueprint/get", params={"blueprint_id": saved["blueprint_id"]})
    assert response.is_success, response.text
    retrieved = response.json()
    assert retrieved["blueprint_id"] == saved["blueprint_id"]
    assert retrieved["version"] == 1
    assert retrieved["display_name"] == "Test Blueprint"
    assert retrieved["tags"] == ["test", "integration"]
    assert retrieved["builder"]["blocks"]["source_42"]["factory_id"]["factory"] == "source_42"
    assert retrieved["builder"]["environment"]["hosts"] == 2
    assert retrieved["builder"]["environment"]["workers_per_host"] == 4

    # Saving again with the same id creates a new version
    payload2 = BlueprintSaveCommand(builder=_make_builder_source_only(), display_name="Test Blueprint v2")
    response = backend_client_with_auth.post(
        "/blueprint/update",
        json={**payload2.model_dump(), "blueprint_id": saved["blueprint_id"], "version": saved["version"]},
    )
    assert response.is_success, response.text
    saved2 = response.json()
    assert saved2["blueprint_id"] == saved["blueprint_id"]
    assert saved2["version"] == 2

    # Retrieve latest returns version 2
    response = backend_client_with_auth.get("/blueprint/get", params={"blueprint_id": saved["blueprint_id"]})
    assert response.is_success, response.text
    latest = response.json()
    assert latest["version"] == 2
    assert latest["display_name"] == "Test Blueprint v2"
    assert latest["builder"]["environment"] is None

    # Retrieve specific version 1 still works
    response = backend_client_with_auth.get("/blueprint/get", params={"blueprint_id": saved["blueprint_id"], "version": 1})
    assert response.is_success, response.text
    assert response.json()["version"] == 1
    assert response.json()["display_name"] == "Test Blueprint"


def test_blueprint_retrieve_nonexistent(backend_client_with_auth: httpx.Client) -> None:
    response = backend_client_with_auth.get("/blueprint/get", params={"blueprint_id": "does-not-exist"})
    assert response.status_code == 404


def test_blueprint_upsert_nonexistent_id(backend_client_with_auth: httpx.Client) -> None:
    """Attempting to add a version to a non-existent id returns 404."""
    builder = _make_builder_source_only()
    payload = BlueprintSaveCommand(builder=builder)
    response = backend_client_with_auth.post("/blueprint/update", json={**payload.model_dump(), "blueprint_id": "no-such-id", "version": 1})
    assert response.status_code == 404


def test_blueprint_expand(tmpdir: Any, backend_client_with_auth: httpx.Client) -> None:
    response = backend_client_with_auth.get("/blueprint/catalogue").raise_for_status()
    assert len(response.json()) > 0

    builder = BlueprintBuilder(blocks={})
    response = backend_client_with_auth.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert response.json()["possible_sources"] == [
        {"plugin": {"store": "localTest", "local": "single"}, "factory": "source_42"},
        {"plugin": {"store": "localTest", "local": "single"}, "factory": "source_text"},
        {"plugin": {"store": "localTest", "local": "single"}, "factory": "source_sleep"},
    ]
    assert response.json()["possible_expansions"] == {}

    source_42 = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("source_42")),
        configuration_values={},
        input_ids={},
    )
    blocks = {BlockInstanceId("source_42"): source_42}
    builder = BlueprintBuilder(blocks=blocks)
    response = backend_client_with_auth.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert response.json()["possible_expansions"] == {
        "source_42": [
            {"plugin": {"store": "localTest", "local": "single"}, "factory": "transform_increment"},
            {"plugin": {"store": "localTest", "local": "single"}, "factory": "product_join"},
            {"plugin": {"store": "localTest", "local": "single"}, "factory": "sink_file"},
        ]
    }

    transform_increment = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("transform_increment")),
        configuration_values={"amount": "2"},
        input_ids={"a": BlockInstanceId("source_42")},
    )
    blocks[BlockInstanceId("transform_increment")] = transform_increment
    builder = BlueprintBuilder(blocks=blocks)
    response = backend_client_with_auth.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert response.json()["possible_expansions"]["transform_increment"] == [
        {"plugin": {"store": "localTest", "local": "single"}, "factory": "transform_increment"},
        {"plugin": {"store": "localTest", "local": "single"}, "factory": "product_join"},
        {"plugin": {"store": "localTest", "local": "single"}, "factory": "sink_file"},
    ]

    product_join = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("product_join")),
        configuration_values={},
        input_ids={"a": BlockInstanceId("transform_increment"), "b": BlockInstanceId("source_42")},
    )
    # Using an unknown glyph should fail validation
    sink_file_bad = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("sink_file")),
        configuration_values={"fname": f"{tmpdir}/output${{blueprintExpandGlobalGlyph}}.main.txt"},
        input_ids={"data": BlockInstanceId("product_join")},
    )
    blocks[BlockInstanceId("product_join")] = product_join
    blocks[BlockInstanceId("sink_file")] = sink_file_bad

    builder = BlueprintBuilder(blocks=blocks)
    response = backend_client_with_auth.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert "sink_file" in response.json()["block_errors"]

    # After posting blueprintExpandGlobalGlyph as a global glyph, the same blueprint should pass validation
    post_resp = backend_client_with_auth.post(
        "/blueprint/glyphs/global/post",
        json={"key": "blueprintExpandGlobalGlyph", "value": "test_expand_value"},
    )
    assert post_resp.is_success, post_resp.text

    response = backend_client_with_auth.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert "sink_file" not in response.json()["block_errors"]
    assert len(response.json()["block_errors"]) == 0
    assert response.json()["resolved_configuration_options"]["sink_file"]["fname"] == f"{tmpdir}/outputtest_expand_value.main.txt"

    # A builder with an intrinsic name used as a local glyph key should fail validation
    builder_invalid_local = BlueprintBuilder(
        blocks=dict(blocks),
        local_glyphs={"runId": "should-not-be-allowed"},
    )
    response = backend_client_with_auth.request(url="/blueprint/expand", method="put", json=builder_invalid_local.model_dump())
    assert len(response.json()["global_errors"]) > 0

    # A block using a local glyph defined on the builder should pass validation
    sink_file_local = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("sink_file")),
        configuration_values={"fname": f"{tmpdir}/output${{blueprintExpandLocalGlyph}}.main.txt"},
        input_ids={"data": BlockInstanceId("product_join")},
    )
    blocks[BlockInstanceId("sink_file")] = sink_file_local
    builder_with_local = BlueprintBuilder(
        blocks=dict(blocks),
        local_glyphs={"blueprintExpandLocalGlyph": "expand_local_value"},
    )
    response = backend_client_with_auth.request(url="/blueprint/expand", method="put", json=builder_with_local.model_dump())
    assert "sink_file" not in response.json()["block_errors"]
    assert len(response.json()["global_errors"]) == 0
    assert response.json()["resolved_configuration_options"]["sink_file"]["fname"] == f"{tmpdir}/outputexpand_local_value.main.txt"

    # A known intrinsic glyph (${runId}) should also pass validation
    sink_file_intrinsic = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("sink_file")),
        configuration_values={"fname": f"{tmpdir}/output${{runId}}.main.txt"},
        input_ids={"data": BlockInstanceId("product_join")},
    )
    blocks[BlockInstanceId("sink_file")] = sink_file_intrinsic

    builder = BlueprintBuilder(blocks=blocks)
    response = backend_client_with_auth.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert len(response.json()["possible_expansions"]["sink_file"]) == 0
    assert len(response.json()["block_errors"]) == 0
    glyphs_resp = backend_client_with_auth.get("/blueprint/glyphs/list", params={"glyph_type": "intrinsic"})
    assert glyphs_resp.is_success, glyphs_resp.text
    run_id_glyph = next(g for g in glyphs_resp.json()["glyphs"] if g["name"] == "runId")
    expected_run_id = run_id_glyph["valueExample"]
    assert response.json()["resolved_configuration_options"]["sink_file"]["fname"] == f"{tmpdir}/output{expected_run_id}.main.txt"


def test_blueprint_basic_execute(tmpdir: Any, backend_client_with_auth: httpx.Client) -> None:
    # Set the global glyph that the builder's source_time block references
    post_resp = backend_client_with_auth.post(
        "/blueprint/glyphs/global/post",
        json={"key": "basicExecuteGlobalGlyph", "value": "initial_value"},
    )
    assert post_resp.is_success, post_resp.text

    builder = _make_builder_full(tmpdir)
    save_req = BlueprintSaveCommand(builder=builder)
    save_resp = backend_client_with_auth.post("/blueprint/create", json=save_req.model_dump())
    assert save_resp.is_success, save_resp.text
    blueprint_id = save_resp.json()["blueprint_id"]
    exec_response = backend_client_with_auth.post("/run/create", json={"blueprint_id": blueprint_id})
    assert exec_response.is_success, exec_response.text
    response = RunCreateResponse(**exec_response.json())
    run_id = response.run_id
    assert response.attempt_count == 1
    ensure_completed_v2(backend_client_with_auth, run_id, sleep=1, attempts=120)

    outputMain = pathlib.Path(f"{tmpdir}/output{run_id}.main.txt")
    assert outputMain.read_text() == "85"  # the output of 42 + 1 + 42, thats what the job is configured to do
    outputMain.unlink()
    status_resp = backend_client_with_auth.get("/run/get", params={"run_id": run_id})
    assert status_resp.is_success, status_resp.text
    created_at = status_resp.json()["created_at"]
    outputTime = pathlib.Path(f"{tmpdir}/output{run_id}.time.txt")
    # Both submitDatetime and startDatetime equal created_at on the first run.
    # created_at is at higher precision than the second-resolution glyph values.
    created_at_sec = created_at.split(".", 1)[0]
    _time_line = outputTime.read_text()
    _time_parts = _time_line.split(";")
    assert _time_parts[0] == created_at_sec
    assert compare_with_tolerance(_time_parts[1], _dt.fromisoformat(created_at_sec))
    assert _time_parts[2] == "initial_value"
    assert _time_parts[3] == "local_glyph_value"
    outputTime.unlink()

    list_resp = backend_client_with_auth.get("/run/list")
    assert list_resp.is_success, list_resp.text
    data = list_resp.json()
    assert "runs" in data
    assert "total" in data
    assert "page" in data
    assert "page_size" in data
    assert "total_pages" in data
    assert data["total"] >= 1
    ids = [e["run_id"] for e in data["runs"]]
    assert run_id in ids

    # Change the global glyph value before restarting — the restart must use the
    # persisted context from attempt 1 and NOT the updated global value.
    update_resp = backend_client_with_auth.post(
        "/blueprint/glyphs/global/post",
        json={"key": "basicExecuteGlobalGlyph", "value": "changed_value"},
    )
    assert update_resp.is_success, update_resp.text

    restart_resp = backend_client_with_auth.post("/run/restart", json={"run_id": run_id, "attempt_count": 1})
    assert restart_resp.is_success, restart_resp.text
    data = restart_resp.json()
    assert data["run_id"] == run_id
    assert data["attempt_count"] == 2

    # Latest-attempt status reflects attempt 2
    status_resp = backend_client_with_auth.get("/run/get", params={"run_id": run_id})
    assert status_resp.is_success, status_resp.text
    assert status_resp.json()["attempt_count"] == 2

    # Attempt 1 is still accessible explicitly
    status_1_resp = backend_client_with_auth.get("/run/get", params={"run_id": run_id, "attempt_count": 1})
    assert status_1_resp.is_success, status_1_resp.text
    assert status_1_resp.json()["attempt_count"] == 1

    ensure_completed_v2(backend_client_with_auth, run_id, sleep=1, attempts=120)
    assert outputMain.read_text() == "85"  # the output of 42 + 1 + 42, thats what the job is configured to do

    # After restart: submitDatetime must still equal original created_at; startDatetime
    # must reflect the restart's own created_at (attempt 2).  The global glyph value
    # must equal "initial_value" — the persisted context from attempt 1 triumphs over
    # the updated global value "changed_value".
    status_restarted_resp = backend_client_with_auth.get("/run/get", params={"run_id": run_id})
    assert status_restarted_resp.is_success, status_restarted_resp.text
    created_at_restarted = status_restarted_resp.json()["created_at"].split(".", 1)[0]
    _time_line_r = outputTime.read_text()
    _time_parts_r = _time_line_r.split(";")
    assert _time_parts_r[0] == created_at_sec
    assert compare_with_tolerance(_time_parts_r[1], _dt.fromisoformat(created_at_restarted), max_seconds=3)
    assert _time_parts_r[2] == "initial_value"
    assert _time_parts_r[3] == "local_glyph_value"

    avail_resp = backend_client_with_auth.get("/run/outputAvailability", params={"run_id": run_id})
    assert avail_resp.is_success, avail_resp.text
    available_tasks = avail_resp.json()
    assert isinstance(available_tasks, list)
    assert len(available_tasks) > 0

    logs_resp = backend_client_with_auth.get("/run/logs", params={"run_id": run_id})
    assert logs_resp.is_success, logs_resp.text
    assert "zip" in logs_resp.headers["content-type"]
    with zipfile.ZipFile(io.BytesIO(logs_resp.content), "r") as zf:
        # NOTE dbEntity, gwState, gateway, controller, host0, host0.dsr, host0.shm, host0.w1, host0.w2
        expected_log_count = 9
        assert len(zf.namelist()) == expected_log_count or os.getenv("FIAB_LOGSTDOUT", "nay") == "yea"


def test_submit_job_v2_execute_missing_blueprint_id(backend_client_with_auth: httpx.Client) -> None:
    """Omitting blueprint_id (required field) returns 422."""
    response = backend_client_with_auth.post("/run/create", json={})
    assert response.status_code == 422


def test_submit_job_v2_execute_unknown_definition(backend_client_with_auth: httpx.Client) -> None:
    """Referencing a non-existent Blueprint returns 404."""
    payload = {"blueprint_id": "does-not-exist"}
    response = backend_client_with_auth.post("/run/create", json=payload)
    assert response.status_code == 404


def test_submit_job_v2_read_status_not_found(backend_client_with_auth: httpx.Client) -> None:
    """GET /execution/get with unknown run_id returns 404."""
    resp = backend_client_with_auth.get("/run/get", params={"run_id": "nonexistent-exec-id"})
    assert resp.status_code == 404


def test_submit_job_v2_restart_not_found(backend_client_with_auth: httpx.Client) -> None:
    """POST /execution/restart with unknown run_id returns 404."""
    resp = backend_client_with_auth.post("/run/restart", json={"run_id": "nonexistent-exec-id", "attempt_count": 1})
    assert resp.status_code == 404


def test_list_available_glyphs(backend_client_with_auth: httpx.Client) -> None:
    """The glyphs/list endpoint returns exactly the set of AvailableIntrinsicGlyphs when glyph_type=intrinsic."""
    response = backend_client_with_auth.get("/blueprint/glyphs/list", params={"glyph_type": "intrinsic"})
    assert response.is_success, response.text
    data = response.json()
    assert "glyphs" in data
    assert "total" in data
    returned_names = {item["name"] for item in data["glyphs"]}
    expected_names = set(get_args(AvailableIntrinsicGlyphs))
    assert returned_names == expected_names
    for item in data["glyphs"]:
        assert "display_name" in item
        assert "valueExample" in item
        assert item["display_name"]
        assert item["valueExample"]

    # Global glyphs list reflects whatever has been posted by other tests; record the baseline
    global_resp = backend_client_with_auth.get("/blueprint/glyphs/list", params={"glyph_type": "global"})
    assert global_resp.is_success, global_resp.text
    global_data = global_resp.json()
    initial_total = global_data["total"]
    assert isinstance(global_data["glyphs"], list)

    # Post a new global glyph and verify the count increases and the glyph appears
    post_resp = backend_client_with_auth.post(
        "/blueprint/glyphs/global/post",
        json={"key": "listGlyphsGlobalGlyph", "value": "list_test_value"},
    )
    assert post_resp.is_success, post_resp.text
    posted = post_resp.json()
    assert posted["key"] == "listGlyphsGlobalGlyph"
    assert posted["value"] == "list_test_value"
    assert "global_glyph_id" in posted

    global_resp2 = backend_client_with_auth.get("/blueprint/glyphs/list", params={"glyph_type": "global"})
    assert global_resp2.is_success, global_resp2.text
    global_data2 = global_resp2.json()
    assert global_data2["total"] == initial_total + 1
    names = {item["name"] for item in global_data2["glyphs"]}
    assert "listGlyphsGlobalGlyph" in names

    get_resp = backend_client_with_auth.get("/blueprint/glyphs/global/get", params={"global_glyph_id": posted["global_glyph_id"]})
    assert get_resp.is_success, get_resp.text
    fetched = get_resp.json()
    assert fetched["key"] == "listGlyphsGlobalGlyph"
    assert fetched["value"] == "list_test_value"
    assert fetched["global_glyph_id"] == posted["global_glyph_id"]

    # Non-admin users must not be able to create public global glyphs
    public_resp = backend_client_with_auth.post(
        "/blueprint/glyphs/global/post",
        json={"key": "shouldBeRejected", "value": "v", "public": True, "overriddable": True},
    )
    assert public_resp.status_code == 403


def test_list_glyph_functions(backend_client_with_auth: httpx.Client) -> None:
    """The glyphs/functions endpoint returns all registered custom functions with name and description."""
    from forecastbox.domain.glyphs.jinja_interpolation import CUSTOM_FUNCTIONS

    response = backend_client_with_auth.get("/blueprint/glyphs/functions")
    assert response.is_success, response.text
    data = response.json()

    assert "functions" in data
    functions = data["functions"]
    assert isinstance(functions, list)
    assert len(functions) == len(CUSTOM_FUNCTIONS)

    returned_names = {fn["name"] for fn in functions}
    expected_names = {fn.name for fn in CUSTOM_FUNCTIONS}
    assert returned_names == expected_names

    for fn in functions:
        assert "name" in fn
        assert "description" in fn
        assert fn["name"]
        assert fn["description"]


def test_blueprint_expand_failure_01(backend_client_with_auth: httpx.Client) -> None:
    """Source has an invalid factory; transform referencing it must not generate its own error."""
    bad_source = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("nonexistent_factory")),
        configuration_values={},
        input_ids={},
    )
    good_transform = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("transform_increment")),
        configuration_values={"amount": "1"},
        input_ids={"a": BlockInstanceId("bad_source")},
    )
    builder = BlueprintBuilder(blocks={BlockInstanceId("bad_source"): bad_source, BlockInstanceId("good_transform"): good_transform})
    response = backend_client_with_auth.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert response.is_success, response.text
    block_errors = response.json()["block_errors"]
    assert "bad_source" in block_errors
    assert "good_transform" not in block_errors


def test_blueprint_expand_failure_02(backend_client_with_auth: httpx.Client) -> None:
    """Transform declares an input id that does not exist in the blueprint; only the transform errors."""
    source_42 = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("source_42")),
        configuration_values={},
        input_ids={},
    )
    bad_transform = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("transform_increment")),
        configuration_values={"amount": "1"},
        input_ids={"a": BlockInstanceId("nonexistent_block")},
    )
    builder = BlueprintBuilder(blocks={BlockInstanceId("source_42"): source_42, BlockInstanceId("bad_transform"): bad_transform})
    response = backend_client_with_auth.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert response.is_success, response.text
    block_errors = response.json()["block_errors"]
    assert "source_42" not in block_errors
    assert "bad_transform" in block_errors


def test_blueprint_expand_failure_03(backend_client_with_auth: httpx.Client) -> None:
    """Bad source and transform with a non-existent input id both report independent errors."""
    bad_source = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("nonexistent_factory")),
        configuration_values={},
        input_ids={},
    )
    bad_transform = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("transform_increment")),
        configuration_values={"amount": "1"},
        input_ids={"a": BlockInstanceId("nonexistent_block")},
    )
    builder = BlueprintBuilder(blocks={BlockInstanceId("bad_source"): bad_source, BlockInstanceId("bad_transform"): bad_transform})
    response = backend_client_with_auth.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert response.is_success, response.text
    block_errors = response.json()["block_errors"]
    assert "bad_source" in block_errors
    assert "bad_transform" in block_errors

    # we now verify that the validation of transform happens in some form, despite parent being invalid
    bad_transform2 = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("transform_increment")),
        configuration_values={"amount": "${nonExistentGlyph}"},
        input_ids={"a": BlockInstanceId("bad_source")},
    )
    builder = BlueprintBuilder(blocks={BlockInstanceId("bad_source"): bad_source, BlockInstanceId("bad_transform"): bad_transform2})
    response = backend_client_with_auth.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert response.is_success, response.text
    block_errors = response.json()["block_errors"]
    assert "bad_source" in block_errors
    assert "bad_transform" in block_errors
    assert "nonExistentGlyph" in ";".join(block_errors["bad_transform"])


def test_blueprint_composite_glyph_expand(tmpdir: Any, backend_client_with_auth: httpx.Client) -> None:
    """A local glyph value that references other glyphs is expanded end-to-end.

    Covers:
    - validate_expand resolves composite glyph values and reflects them in resolved_configuration_options
    - A circular glyph reference is reported as a global_error
    """
    # Post a global glyph that the composite local glyph will reference
    post_resp = backend_client_with_auth.post(
        "/blueprint/glyphs/global/post",
        json={"key": "compositeExpandGlobalPart", "value": "global_part"},
    )
    assert post_resp.is_success, post_resp.text

    # Build a blueprint whose local glyph composes the global part and a known intrinsic
    source_text = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("source_text")),
        configuration_values={"text": "${compositeLocalGlyph}"},
        input_ids={},
    )
    sink_file = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("sink_file")),
        configuration_values={"fname": f"{tmpdir}/composite_expand_output.txt"},
        input_ids={"data": BlockInstanceId("source_text")},
    )
    builder = BlueprintBuilder(
        blocks={BlockInstanceId("source_text"): source_text, BlockInstanceId("sink_file"): sink_file},
        local_glyphs={"compositeLocalGlyph": "${compositeExpandGlobalPart}/${runId}"},
    )
    response = backend_client_with_auth.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert response.is_success, response.text
    data = response.json()
    assert len(data["global_errors"]) == 0
    assert len(data["block_errors"]) == 0
    # Fetch the intrinsic runId example to verify the fully-resolved composite value
    glyphs_resp = backend_client_with_auth.get("/blueprint/glyphs/list", params={"glyph_type": "intrinsic"})
    assert glyphs_resp.is_success, glyphs_resp.text
    run_id_example = next(g["valueExample"] for g in glyphs_resp.json()["glyphs"] if g["name"] == "runId")
    resolved_text = data["resolved_configuration_options"]["source_text"]["text"]
    assert resolved_text == f"global_part/{run_id_example}", f"Unexpected: {resolved_text!r}"

    # A local glyph that references an unknown glyph must surface as a block_error,
    # even though the composite glyph key itself is known.
    sink_file_missing = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("sink_file")),
        configuration_values={"fname": f"{tmpdir}/output.txt"},
        input_ids={"data": BlockInstanceId("source_text")},
    )
    builder_nested_unknown = BlueprintBuilder(
        blocks={BlockInstanceId("source_text"): source_text, BlockInstanceId("sink_file"): sink_file_missing},
        local_glyphs={"compositeLocalGlyph": "${compositeExpandGlobalPart}/${notDefinedAnywhere}"},
    )
    response_nested = backend_client_with_auth.request(url="/blueprint/expand", method="put", json=builder_nested_unknown.model_dump())
    assert response_nested.is_success, response_nested.text
    nested_data = response_nested.json()
    assert "source_text" in nested_data["block_errors"]
    assert any("notDefinedAnywhere" in err for err in nested_data["block_errors"]["source_text"])

    # A builder with a circular glyph reference must report a global_error
    builder_cyclic = BlueprintBuilder(
        blocks={BlockInstanceId("source_text"): source_text, BlockInstanceId("sink_file"): sink_file},
        local_glyphs={"compositeLocalGlyph": "${compositeLocalGlyph}/suffix"},
    )
    response_cyclic = backend_client_with_auth.request(url="/blueprint/expand", method="put", json=builder_cyclic.model_dump())
    assert response_cyclic.is_success, response_cyclic.text
    cyclic_data = response_cyclic.json()
    assert len(cyclic_data["global_errors"]) > 0
    assert any("circular" in err.lower() or "cycle" in err.lower() for err in cyclic_data["global_errors"])


def test_blueprint_composite_glyph_execute(tmpdir: Any, backend_client_with_auth: httpx.Client) -> None:
    """Execute a blueprint whose config value is resolved via a composite local glyph.

    The composite glyph ``${compositeExecGlobalPart}/${runId}`` must be fully expanded
    at runtime and the output must reflect the expanded value.
    On restart the runId component must remain stable (runId is preserved, not pinned).
    """
    post_resp = backend_client_with_auth.post(
        "/blueprint/glyphs/global/post",
        json={"key": "compositeExecGlobalPart", "value": "exec_global"},
    )
    assert post_resp.is_success, post_resp.text

    source_text = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("source_text")),
        configuration_values={"text": "${compositeLocalGlyphExec}"},
        input_ids={},
    )
    sink_file = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("sink_file")),
        configuration_values={"fname": f"{tmpdir}/composite_exec_output.txt"},
        input_ids={"data": BlockInstanceId("source_text")},
    )
    builder = BlueprintBuilder(
        blocks={BlockInstanceId("source_text"): source_text, BlockInstanceId("sink_file"): sink_file},
        local_glyphs={"compositeLocalGlyphExec": "${compositeExecGlobalPart}/${runId}"},
    )
    save_resp = backend_client_with_auth.post("/blueprint/create", json=BlueprintSaveCommand(builder=builder).model_dump())
    assert save_resp.is_success, save_resp.text
    blueprint_id = save_resp.json()["blueprint_id"]

    exec_resp = backend_client_with_auth.post("/run/create", json={"blueprint_id": blueprint_id})
    assert exec_resp.is_success, exec_resp.text
    run_id = exec_resp.json()["run_id"]

    ensure_completed_v2(backend_client_with_auth, run_id, sleep=1, attempts=120)

    output = pathlib.Path(f"{tmpdir}/composite_exec_output.txt")
    content = output.read_text()
    # Content must be "exec_global/<run_id>"
    assert content == f"exec_global/{run_id}", f"Unexpected output: {content!r}"
    output.unlink()


# ---------------------------------------------------------------------------
# Run delete and output-content tests
# ---------------------------------------------------------------------------


def _make_builder_source_and_sink(tmpdir: str) -> BlueprintBuilder:
    """Minimal two-block blueprint: source_42 → sink_file.

    Produces exactly one non-sink task (source_42) whose output is the integer 42,
    and one sink task (sink_file).
    """
    source_42 = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("source_42")),
        configuration_values={},
        input_ids={},
    )
    sink = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("sink_file")),
        configuration_values={"fname": f"{tmpdir}/output_${{runId}}.txt"},
        input_ids={"data": BlockInstanceId("source_42")},
    )
    return BlueprintBuilder(blocks={BlockInstanceId("source_42"): source_42, BlockInstanceId("my_sink"): sink})


def test_run_delete_not_found(backend_client_with_auth: httpx.Client) -> None:
    """POST /run/delete with a non-existent run_id returns 404."""
    resp = backend_client_with_auth.post("/run/delete", json={"run_id": "nonexistent-run-id", "attempt_count": 1})
    assert resp.status_code == 404


def test_run_delete_attempt_conflict(backend_client_with_auth: httpx.Client) -> None:
    """POST /run/delete with a mismatched attempt_count returns 409."""
    builder = _make_builder_source_only()
    save_resp = backend_client_with_auth.post("/blueprint/create", json=BlueprintSaveCommand(builder=builder).model_dump())
    assert save_resp.is_success, save_resp.text
    blueprint_id = save_resp.json()["blueprint_id"]

    run_resp = backend_client_with_auth.post("/run/create", json={"blueprint_id": blueprint_id})
    assert run_resp.is_success, run_resp.text
    run_id = run_resp.json()["run_id"]
    attempt_count = run_resp.json()["attempt_count"]

    del_resp = backend_client_with_auth.post("/run/delete", json={"run_id": run_id, "attempt_count": attempt_count + 1})
    assert del_resp.status_code == 409


def test_run_restart_attempt_conflict(backend_client_with_auth: httpx.Client) -> None:
    """POST /run/restart with a mismatched attempt_count returns 409."""
    builder = _make_builder_source_only()
    save_resp = backend_client_with_auth.post("/blueprint/create", json=BlueprintSaveCommand(builder=builder).model_dump())
    assert save_resp.is_success, save_resp.text
    blueprint_id = save_resp.json()["blueprint_id"]

    run_resp = backend_client_with_auth.post("/run/create", json={"blueprint_id": blueprint_id})
    assert run_resp.is_success, run_resp.text
    run_id = run_resp.json()["run_id"]
    attempt_count = run_resp.json()["attempt_count"]

    restart_resp = backend_client_with_auth.post("/run/restart", json={"run_id": run_id, "attempt_count": attempt_count + 1})
    assert restart_resp.status_code == 409


def test_run_delete_ok(tmpdir: Any, backend_client_with_auth: httpx.Client) -> None:
    """Create a run, wait for completion, delete it, verify it disappears."""
    builder = _make_builder_source_and_sink(tmpdir)
    save_resp = backend_client_with_auth.post("/blueprint/create", json=BlueprintSaveCommand(builder=builder).model_dump())
    assert save_resp.is_success, save_resp.text
    blueprint_id = save_resp.json()["blueprint_id"]

    run_resp = backend_client_with_auth.post("/run/create", json={"blueprint_id": blueprint_id})
    assert run_resp.is_success, run_resp.text
    run_id = run_resp.json()["run_id"]
    attempt_count = run_resp.json()["attempt_count"]

    ensure_completed_v2(backend_client_with_auth, run_id, sleep=1, attempts=120)

    total_before = backend_client_with_auth.get("/run/list").raise_for_status().json()["total"]

    del_resp = backend_client_with_auth.post("/run/delete", json={"run_id": run_id, "attempt_count": attempt_count})
    assert del_resp.is_success, del_resp.text

    # Deleted run is no longer accessible
    get_resp = backend_client_with_auth.get("/run/get", params={"run_id": run_id})
    assert get_resp.status_code == 404

    # And no longer appears in the list
    list_after = backend_client_with_auth.get("/run/list").raise_for_status().json()
    assert list_after["total"] == total_before - 1
    assert run_id not in [r["run_id"] for r in list_after["runs"]]


def test_run_output_content(tmpdir: Any, backend_client_with_auth: httpx.Client) -> None:
    """Execute a run, wait for completion, then retrieve output content via outputContent."""
    builder = _make_builder_source_and_sink(tmpdir)
    save_resp = backend_client_with_auth.post("/blueprint/create", json=BlueprintSaveCommand(builder=builder).model_dump())
    assert save_resp.is_success, save_resp.text
    blueprint_id = save_resp.json()["blueprint_id"]

    run_resp = backend_client_with_auth.post("/run/create", json={"blueprint_id": blueprint_id})
    assert run_resp.is_success, run_resp.text
    run_id = run_resp.json()["run_id"]

    ensure_completed_v2(backend_client_with_auth, run_id, sleep=1, attempts=120)

    avail_resp = backend_client_with_auth.get("/run/outputAvailability", params={"run_id": run_id})
    assert avail_resp.is_success, avail_resp.text
    available_tasks = avail_resp.json()
    assert len(available_tasks) > 0

    # Cascade only exposes sink tasks as ext_outputs; our blueprint has exactly one sink (my_sink).
    # Its task ID encodes the runtime function name: fiab_plugin_test.runtime.sink_file:<hash>
    sink_tasks = [t for t in available_tasks if "sink_file" in t]
    assert len(sink_tasks) == 1, f"Expected exactly one sink_file task, got: {available_tasks}"
    sink_task_id = sink_tasks[0]

    content_resp = backend_client_with_auth.get(
        "/run/outputContent",
        params={"run_id": run_id, "dataset_id": sink_task_id},
        # macOS has a delayed first cloudpickle import under forking; give it more time
        timeout=40.0 if sys.platform == "darwin" else None,
    )
    assert content_resp.is_success, content_resp.text
    assert content_resp.headers.get("content-type", "").startswith("application/clpkl")
    assert cloudpickle.loads(content_resp.content) == "ok"

    if sys.platform == "darwin":
        # Re-fetch without an extended timeout to confirm the import delay was a one-off
        content_resp2 = backend_client_with_auth.get("/run/outputContent", params={"run_id": run_id, "dataset_id": sink_task_id})
        assert content_resp2.is_success, content_resp2.text
        assert cloudpickle.loads(content_resp2.content) == "ok"


def _wait_until_running(client: httpx.Client, run_id: str, sleep: float = 1.0, attempts: int = 60) -> None:
    def do_action() -> Any:
        resp = client.get("/run/get", params={"run_id": run_id}, timeout=10)
        assert resp.is_success, resp.text
        return resp.json()

    def verify_ok(data: Any) -> bool | None:
        status = data["status"]
        if status in ("failed", "unknown"):
            raise RuntimeError(f"Run {run_id} reached terminal status {status!r} before running: {data}")
        return True if status == "running" else None

    retry_until(do_action, verify_ok, attempts=attempts, sleep=sleep, error_msg=f"Run {run_id} never reached 'running'")


@pytest.mark.skip("leaves hanging process behind")
def test_gateway_restart_with_in_progress_job(backend_client_with_auth: httpx.Client) -> None:
    """Kill the gateway while a job is active; verify the expected status transitions."""
    sleeper = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("source_sleep")),
        configuration_values={"text": "hello", "duration": "30"},
        input_ids={},
    )
    sink = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory=BlockFactoryId("sink_file")),
        configuration_values={"fname": "/dev/null"},
        input_ids={"data": BlockInstanceId("sleeper")},
    )
    builder = BlueprintBuilder(blocks={BlockInstanceId("sleeper"): sleeper, BlockInstanceId("sleeper_sink"): sink})
    save_resp = backend_client_with_auth.post("/blueprint/create", json=BlueprintSaveCommand(builder=builder).model_dump())
    assert save_resp.is_success, save_resp.text
    blueprint_id = save_resp.json()["blueprint_id"]

    run_resp = backend_client_with_auth.post("/run/create", json={"blueprint_id": blueprint_id})
    assert run_resp.is_success, run_resp.text
    run_id = run_resp.json()["run_id"]

    _wait_until_running(backend_client_with_auth, run_id)

    # TODO this leaves the workers hanging. We need some solution to collect them properly
    kill_resp = backend_client_with_auth.post("/gateway/kill")
    assert kill_resp.is_success, kill_resp.text

    # Polling while the gateway is down returns "unknown"
    status_resp = backend_client_with_auth.get("/run/get", params={"run_id": run_id}, timeout=30)
    assert status_resp.is_success, status_resp.text
    assert status_resp.json()["status"] == "unknown"
    assert "failed to communicate with gateway" in status_resp.json()["error"]

    start_resp = backend_client_with_auth.post("/gateway/start")
    assert start_resp.is_success, start_resp.text

    # After the gateway restarts (fresh, empty), the job is unknown to it → "evicted from gateway"
    def poll_evicted() -> Any:
        resp = backend_client_with_auth.get("/run/get", params={"run_id": run_id}, timeout=10)
        assert resp.is_success, resp.text
        return resp.json()

    def verify_evicted(data: Any) -> bool | None:
        if data["status"] == "failed" and data.get("error") == "evicted from gateway":
            return True
        if data["status"] == "completed":
            raise RuntimeError(f"Unexpected terminal status: {data}")
        return None

    retry_until(poll_evicted, verify_evicted, attempts=30, sleep=1.0, error_msg=f"Run {run_id} never reached 'evicted from gateway'")

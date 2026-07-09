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

# TODO this file has grown too huge, we should start splitting it. In particular,
# lot of things tests just the expand endpoint -- which however can be tested as
# a unit test because there is no real side effects. We would just need to fake
# the global glyph database

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
from fiab_core.fable import BlockFactoryId, BlockInstance, BlockInstanceId, ConfigurationOptionId, PluginCompositeId

from forecastbox.domain.blueprint.cascade import EnvironmentSpecification
from forecastbox.domain.blueprint.service import BlueprintBuilder, BlueprintSaveCommand, RoutableBlock, Tag
from forecastbox.domain.glyphs.intrinsic import AvailableIntrinsicGlyphs
from forecastbox.routes.run import CompilationDetailResponse, RunCreateResponse

from .conftest import fake_artifact_store_id, test_blueprint_artifact_id, testPluginId
from .utils import compare_with_tolerance, retry_until


def _config(values: dict[str, str]) -> dict[ConfigurationOptionId, str]:
    return {ConfigurationOptionId(key): value for key, value in values.items()}


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
    source_42 = RoutableBlock(
        instance_id=BlockInstanceId("source_42"),
        plugin=testPluginId,
        factory=BlockFactoryId("source_42"),
        instance=BlockInstance(
            configuration_values={},
            input_ids={},
        ),
    )
    return BlueprintBuilder(
        blocks=[
            source_42,
        ]
    )


def _make_builder_full(tmpdir: str) -> BlueprintBuilder:
    source_42 = RoutableBlock(
        instance_id=BlockInstanceId("source_42"),
        plugin=testPluginId,
        factory=BlockFactoryId("source_42"),
        instance=BlockInstance(
            configuration_values={},
            input_ids={},
        ),
    )
    transform_increment = RoutableBlock(
        instance_id=BlockInstanceId("transform_increment"),
        plugin=testPluginId,
        factory=BlockFactoryId("transform_increment"),
        instance=BlockInstance(
            configuration_values=_config({"amount": "1"}),
            input_ids={"a": BlockInstanceId("source_42")},
        ),
    )
    product_join = RoutableBlock(
        instance_id=BlockInstanceId("product_join"),
        plugin=testPluginId,
        factory=BlockFactoryId("product_join"),
        instance=BlockInstance(
            configuration_values={},
            input_ids={"a": BlockInstanceId("transform_increment"), "b": BlockInstanceId("source_42")},
        ),
    )
    sink_main = RoutableBlock(
        instance_id=BlockInstanceId("sink_main"),
        plugin=testPluginId,
        factory=BlockFactoryId("sink_file"),
        instance=BlockInstance(
            configuration_values=_config({"fname": f"{tmpdir}/output${{runId}}.main.txt"}),
            input_ids={"data": BlockInstanceId("product_join")},
        ),
    )
    source_time = RoutableBlock(
        instance_id=BlockInstanceId("source_time"),
        plugin=testPluginId,
        factory=BlockFactoryId("source_text"),
        instance=BlockInstance(
            configuration_values=_config(
                {"text": "${submitDatetime};${startDatetime};${basicExecuteGlobalGlyph};${blueprintExecuteLocalGlyph}"}
            ),
        ),
    )
    sink_time = RoutableBlock(
        instance_id=BlockInstanceId("sink_time"),
        plugin=testPluginId,
        factory=BlockFactoryId("sink_file"),
        instance=BlockInstance(
            configuration_values=_config({"fname": f"{tmpdir}/output${{runId}}.time.txt"}),
            input_ids={"data": BlockInstanceId("source_time")},
        ),
    )
    return BlueprintBuilder(
        blocks=[
            source_42,
            transform_increment,
            product_join,
            sink_main,
            source_time,
            sink_time,
        ],
        local_glyphs={"blueprintExecuteLocalGlyph": "local_glyph_value"},
    )


def test_blueprint_save_and_retrieve(backend_client_user: httpx.Client) -> None:
    builder = _make_builder_source_only()
    builder.environment = EnvironmentSpecification(hosts=2, workers_per_host=4)
    payload = BlueprintSaveCommand(
        builder=builder,
        display_name="Test Blueprint",
        display_description="A blueprint saved via the v2 API",
        tags=[Tag(key="test"), Tag(key="integration")],
    )

    # Save new blueprint
    response = backend_client_user.post("/blueprint/create", json=payload.model_dump())
    assert response.is_success, response.text
    saved = response.json()
    assert "blueprint_id" in saved
    assert saved["version"] == 1

    # Retrieve by id (latest version)
    response = backend_client_user.get("/blueprint/get", params={"blueprint_id": saved["blueprint_id"]})
    assert response.is_success, response.text
    retrieved = response.json()
    assert retrieved["blueprint_id"] == saved["blueprint_id"]
    assert retrieved["version"] == 1
    assert retrieved["display_name"] == "Test Blueprint"
    assert retrieved["tags"] == [{"key": "test", "value": None}, {"key": "integration", "value": None}]
    source_42_block = next(b for b in retrieved["builder"]["blocks"] if b["instance_id"] == "source_42")
    assert source_42_block["factory"] == "source_42"
    assert retrieved["builder"]["environment"]["hosts"] == 2
    assert retrieved["builder"]["environment"]["workers_per_host"] == 4

    # Saving again with the same id creates a new version
    payload2 = BlueprintSaveCommand(builder=_make_builder_source_only(), display_name="Test Blueprint v2")
    response = backend_client_user.post(
        "/blueprint/update",
        json={**payload2.model_dump(), "blueprint_id": saved["blueprint_id"], "version": saved["version"]},
    )
    assert response.is_success, response.text
    saved2 = response.json()
    assert saved2["blueprint_id"] == saved["blueprint_id"]
    assert saved2["version"] == 2

    # Retrieve latest returns version 2
    response = backend_client_user.get("/blueprint/get", params={"blueprint_id": saved["blueprint_id"]})
    assert response.is_success, response.text
    latest = response.json()
    assert latest["version"] == 2
    assert latest["display_name"] == "Test Blueprint v2"
    assert latest["builder"]["environment"] is None

    # Retrieve specific version 1 still works
    response = backend_client_user.get("/blueprint/get", params={"blueprint_id": saved["blueprint_id"], "version": 1})
    assert response.is_success, response.text
    assert response.json()["version"] == 1
    assert response.json()["display_name"] == "Test Blueprint"

    # Verify source/created_by filters work correctly.
    me_response = backend_client_user.get("/users/me")
    assert me_response.is_success, me_response.text
    my_user_id = me_response.json()["id"]

    # Filtering by source=user_defined and correct created_by must include the blueprint.
    response = backend_client_user.get("/blueprint/list", params={"source": "user_defined", "created_by": my_user_id})
    assert response.is_success, response.text
    ids = [b["blueprint_id"] for b in response.json()["blueprints"]]
    assert saved["blueprint_id"] in ids, f"Expected blueprint to appear when filtered by source=user_defined and created_by={my_user_id!r}"

    # Filtering by a different source must not include it.
    response = backend_client_user.get("/blueprint/list", params={"source": "plugin_template", "created_by": my_user_id})
    assert response.is_success, response.text
    ids = [b["blueprint_id"] for b in response.json()["blueprints"]]
    assert saved["blueprint_id"] not in ids, "Blueprint should not appear when filtered by source=plugin_template"

    # Filtering by a non-existent created_by must not include it.
    response = backend_client_user.get("/blueprint/list", params={"source": "user_defined", "created_by": "nonexistent-user-000"})
    assert response.is_success, response.text
    ids = [b["blueprint_id"] for b in response.json()["blueprints"]]
    assert saved["blueprint_id"] not in ids, "Blueprint should not appear when created_by does not match"


def test_blueprint_retrieve_nonexistent(backend_client_user: httpx.Client) -> None:
    response = backend_client_user.get("/blueprint/get", params={"blueprint_id": "does-not-exist"})
    assert response.status_code == 404


def test_blueprint_upsert_nonexistent_id(backend_client_user: httpx.Client) -> None:
    """Attempting to add a version to a non-existent id returns 404."""
    builder = _make_builder_source_only()
    payload = BlueprintSaveCommand(builder=builder)
    response = backend_client_user.post("/blueprint/update", json={**payload.model_dump(), "blueprint_id": "no-such-id", "version": 1})
    assert response.status_code == 404


def test_plugin_template_in_blueprint_list(backend_client_user: httpx.Client) -> None:
    """Verify that the testBasic plugin template appears in the blueprint list after startup."""
    from .conftest import testPluginId

    def do_action() -> dict:
        response = backend_client_user.get("/plugin/status", timeout=10)
        assert response.is_success
        return response.json()

    def verify_ok(data: dict) -> dict | None:
        return data if data.get("updater_status") == "ok" else None

    retry_until(do_action, verify_ok, attempts=30, sleep=1.0, error_msg="Plugin loader did not reach 'ok' status")

    response = backend_client_user.get("/blueprint/list", timeout=10)
    assert response.is_success, response.text
    blueprints = response.json()["blueprints"]
    matches = [b for b in blueprints if b.get("source") == "plugin_template" and b.get("display_name") == "testBasic"]
    assert len(matches) == 1, f"Expected exactly one 'testBasic' plugin_template blueprint in the list, got: {blueprints}"

    # Filtering by source=plugin_template must return testBasic.
    response = backend_client_user.get("/blueprint/list", params={"source": "plugin_template"}, timeout=10)
    assert response.is_success, response.text
    source_filtered = response.json()["blueprints"]
    assert any(b.get("display_name") == "testBasic" for b in source_filtered), (
        f"testBasic should appear when filtered by source=plugin_template, got: {source_filtered}"
    )

    # Filtering by created_by=localTest:single must return testBasic.
    response = backend_client_user.get("/blueprint/list", params={"created_by": "localTest:single"}, timeout=10)
    assert response.is_success, response.text
    owner_filtered = response.json()["blueprints"]
    assert any(b.get("display_name") == "testBasic" for b in owner_filtered), (
        f"testBasic should appear when filtered by created_by=localTest:single, got: {owner_filtered}"
    )

    # The templateExampleValues route returns the correct examples for testBasic.
    response = backend_client_user.get(
        "/plugin/templateExampleValues",
        params={"store": testPluginId.store, "local": testPluginId.local, "displayName": "testBasic"},
        timeout=10,
    )
    assert response.is_success, f"Expected 200 for testBasic example values, got: {response.status_code} {response.text}"
    data = response.json()
    assert "example_values" in data
    assert "example_glyphs" in data
    assert data["example_glyphs"].get("name") == "world", f"Expected name=world in example_glyphs, got: {data['example_glyphs']}"


def test_plugin_template_exclusion(backend_client_user: httpx.Client, backend_client_admin: httpx.Client) -> None:
    """Excluding a template via POST /plugin/settings removes it from the blueprint list.
    Also verifies that glyph_remapping renames glyph references in testRemapping after re-ingest.
    """
    from .conftest import testPluginId

    # Verify testExclusion and testRemapping are initially present.
    response = backend_client_user.get("/blueprint/list", timeout=10)
    assert response.is_success, response.text
    blueprints = response.json()["blueprints"]
    assert any(b.get("display_name") == "testExclusion" for b in blueprints), (
        f"testExclusion should be present before exclusion, got: {[b.get('display_name') for b in blueprints]}"
    )
    assert any(b.get("display_name") == "testRemapping" for b in blueprints), (
        f"testRemapping should be present before remapping, got: {[b.get('display_name') for b in blueprints]}"
    )

    # Exclude testExclusion and set a glyph remapping for testRemapping via the admin settings route.
    response = backend_client_admin.post(
        "/plugin/settings",
        json={
            "pluginCompositeId": testPluginId.model_dump(),
            "excluded_templates": ["testExclusion"],
            "glyph_remapping": {"pluginGlyphOld": "pluginGlyphNew", "localOld": "localNew"},
        },
        timeout=10,
    )
    assert response.status_code in (200, 202), f"Unexpected status from /plugin/settings: {response.status_code} {response.text}"

    # Wait for the re-ingest to complete.
    def do_action() -> dict:
        resp = backend_client_user.get("/plugin/status", timeout=10)
        assert resp.is_success
        return resp.json()

    def verify_ok(data: dict) -> dict | None:
        return data if data.get("updater_status") == "ok" else None

    retry_until(do_action, verify_ok, attempts=30, sleep=1.0, error_msg="Plugin re-ingest did not reach 'ok' status")

    # testExclusion must be gone; testBasic and testRemapping must remain.
    response = backend_client_user.get("/blueprint/list", timeout=10)
    assert response.is_success, response.text
    blueprints = response.json()["blueprints"]
    names = [b.get("display_name") for b in blueprints if b.get("source") == "plugin_template"]
    assert "testExclusion" not in names, f"testExclusion should have been excluded, but found: {names}"
    assert "testBasic" in names, f"testBasic should still be present, but found: {names}"
    assert "testRemapping" in names, f"testRemapping should be present, but found: {names}"

    # Verify that /plugin/status reflects the active/excluded template split correctly.
    plugin_id_key = str(testPluginId)
    status_response = backend_client_user.get("/plugin/status", timeout=10)
    assert status_response.is_success, status_response.text
    status_data = status_response.json()
    active = status_data.get("plugin_active_templates", {}).get(plugin_id_key, [])
    excluded_names = status_data.get("plugin_excluded_template_names", {}).get(plugin_id_key, [])
    assert "testExclusion" not in active, f"testExclusion should not be active, got: {active}"
    assert "testBasic" in active, f"testBasic should be active, got: {active}"
    assert "testRemapping" in active, f"testRemapping should be active, got: {active}"
    assert "testExclusion" in excluded_names, f"testExclusion should appear in excluded_template_names, got: {excluded_names}"

    # Excluded template must return 403 from templateExampleValues.
    response = backend_client_user.get(
        "/plugin/templateExampleValues",
        params={"store": testPluginId.store, "local": testPluginId.local, "displayName": "testExclusion"},
        timeout=10,
    )
    assert response.status_code == 403, f"Expected 403 for excluded testExclusion, got: {response.status_code} {response.text}"

    # Unknown display name in a known plugin -> 404.
    response = backend_client_user.get(
        "/plugin/templateExampleValues",
        params={"store": testPluginId.store, "local": testPluginId.local, "displayName": "doesNotExist"},
        timeout=10,
    )
    assert response.status_code == 404, f"Expected 404 for unknown displayName, got: {response.status_code} {response.text}"

    # Unknown plugin -> 404.
    response = backend_client_user.get(
        "/plugin/templateExampleValues",
        params={"store": "unknownStore", "local": "unknownPlugin", "displayName": "testBasic"},
        timeout=10,
    )
    assert response.status_code == 404, f"Expected 404 for unknown plugin, got: {response.status_code} {response.text}"

    # Verify that the glyph remapping was applied to testRemapping.
    remap_item = next(b for b in blueprints if b.get("display_name") == "testRemapping")
    remap_id = remap_item["blueprint_id"]
    response = backend_client_user.get(f"/blueprint/get?blueprint_id={remap_id}", timeout=10)
    assert response.is_success, response.text
    builder_data = response.json()["builder"]
    # The block config value must reference the renamed glyph.
    config_values = builder_data["blocks"][0]["instance"]["configuration_values"]
    assert any("pluginGlyphNew" in v for v in config_values.values()), (
        f"Expected pluginGlyphNew in config values after remapping, got: {config_values}"
    )
    assert not any("pluginGlyphOld" in v for v in config_values.values()), (
        f"pluginGlyphOld should have been renamed, but found in config values: {config_values}"
    )
    # The local glyph key and value must also be renamed.
    local_glyphs = builder_data["local_glyphs"]
    assert "localNew" in local_glyphs, f"Expected localNew in local_glyphs after remapping, got: {local_glyphs}"
    assert "localOld" not in local_glyphs, f"localOld should have been renamed, got: {local_glyphs}"
    assert "pluginGlyphNew" in local_glyphs.get("localNew", ""), f"Expected localNew value to reference pluginGlyphNew, got: {local_glyphs}"


def test_plugin_template_validation_failure(backend_client_user: httpx.Client) -> None:
    """Templates that fail validation with their example values are absent from the blueprint list
    and their error is reported in plugin_errors in the plugin status."""
    from .conftest import testPluginId

    # Wait for the initial plugin load to finish.
    def do_action() -> dict:
        response = backend_client_user.get("/plugin/status", timeout=10)
        assert response.is_success
        return response.json()

    def verify_ok(data: dict) -> dict | None:
        return data if data.get("updater_status") == "ok" else None

    status = retry_until(do_action, verify_ok, attempts=30, sleep=1.0, error_msg="Plugin loader did not reach 'ok' status")

    # testFailValidation must NOT appear in the blueprint list.
    response = backend_client_user.get("/blueprint/list", timeout=10)
    assert response.is_success, response.text
    blueprints = response.json()["blueprints"]
    names = [b.get("display_name") for b in blueprints if b.get("source") == "plugin_template"]
    assert "testFailValidation" not in names, f"testFailValidation should have been rejected but found in: {names}"

    # Its error must be reported in plugin_errors (merged alongside install errors).
    # PluginsStatus dict keys for PluginCompositeId are serialized via str(plugin_id).
    plugin_id_key = str(testPluginId)
    plugin_errors = status.get("plugin_errors", {})
    plugin_error_entries = plugin_errors.get(plugin_id_key, [])
    details = " ".join(e.get("detail", "") for e in plugin_error_entries)
    assert "testFailValidation" in details, (
        f"Expected 'testFailValidation' in plugin_errors[{plugin_id_key!r}], got: {plugin_error_entries!r}"
    )


def test_blueprint_expand(tmpdir: Any, backend_client_user: httpx.Client) -> None:
    response = backend_client_user.get("/blueprint/catalogue").raise_for_status()
    assert len(response.json()) > 0

    builder = BlueprintBuilder(blocks=[])
    response = backend_client_user.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert response.json()["possible_sources"] == [
        {"plugin": {"store": "localTest", "local": "single"}, "factory": "source_42"},
        {"plugin": {"store": "localTest", "local": "single"}, "factory": "source_text"},
        {"plugin": {"store": "localTest", "local": "single"}, "factory": "source_sleep"},
        {"plugin": {"store": "localTest", "local": "single"}, "factory": "source_filesize"},
    ]
    assert response.json()["possible_expansions"] == {}

    source_42 = RoutableBlock(
        instance_id=BlockInstanceId("source_42"),
        plugin=testPluginId,
        factory=BlockFactoryId("source_42"),
        instance=BlockInstance(
            configuration_values={},
            input_ids={},
        ),
    )
    blocks = [source_42]
    builder = BlueprintBuilder(blocks=blocks)
    response = backend_client_user.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert response.json()["possible_expansions"] == {
        "source_42": [
            {
                "plugin": {"store": "localTest", "local": "single"},
                "factory": "transform_increment",
                "restrictions": {"amount": "enumClosed[1,2,3]"},
            },
            {"plugin": {"store": "localTest", "local": "single"}, "factory": "product_join", "restrictions": {}},
            {"plugin": {"store": "localTest", "local": "single"}, "factory": "sink_file", "restrictions": {}},
            {"plugin": {"store": "localTest", "local": "single"}, "factory": "sink_image", "restrictions": {}},
        ]
    }

    transform_increment = RoutableBlock(
        instance_id=BlockInstanceId("transform_increment"),
        plugin=testPluginId,
        factory=BlockFactoryId("transform_increment"),
        instance=BlockInstance(
            configuration_values=_config({"amount": "2"}),
            input_ids={"a": BlockInstanceId("source_42")},
        ),
    )
    blocks.append(transform_increment)
    builder = BlueprintBuilder(blocks=blocks)
    response = backend_client_user.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert response.json()["possible_expansions"]["transform_increment"] == [
        {
            "plugin": {"store": "localTest", "local": "single"},
            "factory": "transform_increment",
            "restrictions": {"amount": "enumClosed[1,2,3]"},
        },
        {"plugin": {"store": "localTest", "local": "single"}, "factory": "product_join", "restrictions": {}},
        {"plugin": {"store": "localTest", "local": "single"}, "factory": "sink_file", "restrictions": {}},
        {"plugin": {"store": "localTest", "local": "single"}, "factory": "sink_image", "restrictions": {}},
    ]

    product_join = RoutableBlock(
        instance_id=BlockInstanceId("product_join"),
        plugin=testPluginId,
        factory=BlockFactoryId("product_join"),
        instance=BlockInstance(
            configuration_values={},
            input_ids={"a": BlockInstanceId("transform_increment"), "b": BlockInstanceId("source_42")},
        ),
    )
    # Using an unknown glyph should not fail validation — it should be reported in missing_glyphs
    sink_file = RoutableBlock(
        instance_id=BlockInstanceId("sink_file"),
        plugin=testPluginId,
        factory=BlockFactoryId("sink_file"),
        instance=BlockInstance(
            configuration_values=_config({"fname": f"{tmpdir}/output${{blueprintExpandGlobalGlyph}}.main.txt"}),
            input_ids={"data": BlockInstanceId("product_join")},
        ),
    )
    blocks.append(product_join)
    blocks.append(sink_file)

    builder = BlueprintBuilder(blocks=blocks)
    response = backend_client_user.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert "sink_file" not in response.json()["block_errors"]
    assert response.json()["missing_glyphs"]["sink_file"]["fname"] == ["blueprintExpandGlobalGlyph"]

    # After posting blueprintExpandGlobalGlyph as a global glyph, missing_glyphs should be empty
    post_resp = backend_client_user.post(
        "/blueprint/glyphs/global/post",
        json={"key": "blueprintExpandGlobalGlyph", "value": "test_expand_value"},
    )
    assert post_resp.is_success, post_resp.text

    response = backend_client_user.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert "sink_file" not in response.json()["block_errors"]
    assert len(response.json()["block_errors"]) == 0
    assert response.json()["missing_glyphs"] == {}
    assert response.json()["resolved_configuration_options"]["sink_file"]["fname"] == f"{tmpdir}/outputtest_expand_value.main.txt"

    # A builder with an intrinsic name used as a local glyph key should fail validation
    builder_invalid_local = BlueprintBuilder(
        blocks=list(blocks),
        local_glyphs={"runId": "should-not-be-allowed"},
    )
    response = backend_client_user.request(url="/blueprint/expand", method="put", json=builder_invalid_local.model_dump())
    assert len(response.json()["global_errors"]) > 0

    # A block using a local glyph defined on the builder should pass validation.
    # Replace the sink_file block in the list with a variant that references the local glyph.
    sink_file_local = RoutableBlock(
        instance_id=BlockInstanceId("sink_file"),
        plugin=testPluginId,
        factory=BlockFactoryId("sink_file"),
        instance=BlockInstance(
            configuration_values=_config({"fname": f"{tmpdir}/output${{blueprintExpandLocalGlyph}}.main.txt"}),
            input_ids={"data": BlockInstanceId("product_join")},
        ),
    )
    blocks = [sink_file_local if b.instance_id == BlockInstanceId("sink_file") else b for b in blocks]
    builder_with_local = BlueprintBuilder(
        blocks=blocks,
        local_glyphs={"blueprintExpandLocalGlyph": "expand_local_value"},
    )
    response = backend_client_user.request(url="/blueprint/expand", method="put", json=builder_with_local.model_dump())
    assert "sink_file" not in response.json()["block_errors"]
    assert len(response.json()["global_errors"]) == 0
    assert response.json()["resolved_configuration_options"]["sink_file"]["fname"] == f"{tmpdir}/outputexpand_local_value.main.txt"

    # A known intrinsic glyph (${runId}) should also pass validation.
    # Replace the sink_file block again with the intrinsic-glyph variant.
    sink_file_intrinsic = RoutableBlock(
        instance_id=BlockInstanceId("sink_file"),
        plugin=testPluginId,
        factory=BlockFactoryId("sink_file"),
        instance=BlockInstance(
            configuration_values=_config({"fname": f"{tmpdir}/output${{runId}}.main.txt"}),
            input_ids={"data": BlockInstanceId("product_join")},
        ),
    )
    blocks = [sink_file_intrinsic if b.instance_id == BlockInstanceId("sink_file") else b for b in blocks]

    builder = BlueprintBuilder(blocks=blocks)
    response = backend_client_user.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    expected_expansion = [{"factory": "sink_file", "plugin": {"local": "single", "store": "localTest"}, "restrictions": {}}]
    # NOTE this looks odd but sink_file produces the url of the file, and that url is a text which can again be written to a file
    assert response.json()["possible_expansions"]["sink_file"] == expected_expansion, "sink_file should expand only to sink_file"
    assert len(response.json()["block_errors"]) == 0
    glyphs_resp = backend_client_user.get("/blueprint/glyphs/list", params={"glyph_type": "intrinsic"})
    assert glyphs_resp.is_success, glyphs_resp.text
    run_id_glyph = next(g for g in glyphs_resp.json()["glyphs"] if g["name"] == "runId")
    expected_run_id = run_id_glyph["valueExample"]
    assert response.json()["resolved_configuration_options"]["sink_file"]["fname"] == f"{tmpdir}/output{expected_run_id}.main.txt"

    # Clean up the global glyph created in this test
    del_resp = backend_client_user.post(
        "/blueprint/glyphs/global/delete",
        json={"global_glyph_id": post_resp.json()["global_glyph_id"]},
    )
    assert del_resp.is_success, del_resp.text


def test_blueprint_expand_restrictions(backend_client_user: httpx.Client) -> None:
    """The expand endpoint carries non-empty restrictions from test plugin hooks.

    The test plugin returns enumClosed[1,2,3] as a restriction on the 'amount'
    configuration option when expanding an int-producing block to transform_increment.
    It also returns the same restriction for transform_increment's own configuration.
    This test verifies both restrictions survive the full route round-trip.
    """
    source_42 = RoutableBlock(
        instance_id=BlockInstanceId("source_42"),
        plugin=testPluginId,
        factory=BlockFactoryId("source_42"),
        instance=BlockInstance(
            configuration_values={},
            input_ids={},
        ),
    )
    builder = BlueprintBuilder(
        blocks=[
            source_42,
        ]
    )
    response = backend_client_user.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert response.is_success, response.text

    expansions = response.json()["possible_expansions"]["source_42"]
    increment_expansion = next(e for e in expansions if e["factory"] == "transform_increment")
    assert increment_expansion["restrictions"] == {"amount": "enumClosed[1,2,3]"}, (
        "transform_increment expansion must carry an enumClosed[1,2,3] restriction on 'amount'"
    )

    transform_increment = RoutableBlock(
        instance_id=BlockInstanceId("transform_increment"),
        plugin=testPluginId,
        factory=BlockFactoryId("transform_increment"),
        instance=BlockInstance(
            configuration_values=_config({"amount": "2"}),
            input_ids={"a": BlockInstanceId("source_42")},
        ),
    )
    builder = BlueprintBuilder(
        blocks=[
            source_42,
            transform_increment,
        ]
    )
    response = backend_client_user.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert response.is_success, response.text
    assert response.json()["configuration_restrictions"]["transform_increment"] == {"amount": "enumClosed[1,2,3]"}


def test_blueprint_expand_missing_glyph_warnings(tmpdir: Any, backend_client_user: httpx.Client) -> None:
    """Unknown glyph references produce missing_glyph warnings, not block_errors.

    Covers:
    - A block with a single option referencing one unknown glyph: missing_glyphs is populated
      for that option, block_errors is not.
    - After the missing glyph is registered as a global glyph, missing_glyphs clears.
    - A block with two options where only one references an unknown glyph: the other option
      is still validated normally.
    - Malformed glyph expressions (syntax errors) remain hard block_errors.
    """
    source_42 = RoutableBlock(
        instance_id=BlockInstanceId("source_42"),
        plugin=testPluginId,
        factory=BlockFactoryId("source_42"),
        instance=BlockInstance(
            configuration_values={},
            input_ids={},
        ),
    )
    # sink_file with fname referencing a missing glyph
    sink_file = RoutableBlock(
        instance_id=BlockInstanceId("sink_file"),
        plugin=testPluginId,
        factory=BlockFactoryId("sink_file"),
        instance=BlockInstance(
            configuration_values=_config({"fname": f"{tmpdir}/output_${{missingRoot}}.txt"}),
            input_ids={"data": BlockInstanceId("source_42")},
        ),
    )
    builder = BlueprintBuilder(
        blocks=[
            source_42,
            sink_file,
        ]
    )
    response = backend_client_user.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert response.is_success, response.text
    data = response.json()

    # Unknown glyph → missing_glyphs entry, not a block_error
    assert "sink_file" not in data["block_errors"]
    assert data["missing_glyphs"]["sink_file"]["fname"] == ["missingRoot"]
    # Other blocks remain unaffected
    assert "source_42" not in data["block_errors"]
    assert "source_42" not in data["missing_glyphs"]

    # Register the missing glyph and verify the warning clears
    post_resp = backend_client_user.post(
        "/blueprint/glyphs/global/post",
        json={"key": "missingRoot", "value": "resolved_root"},
    )
    assert post_resp.is_success, post_resp.text
    response2 = backend_client_user.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert response2.is_success, response2.text
    data2 = response2.json()
    assert data2["missing_glyphs"] == {}
    assert data2["block_errors"] == {}
    assert data2["resolved_configuration_options"]["sink_file"]["fname"] == f"{tmpdir}/output_resolved_root.txt"

    # Clean up
    del_resp = backend_client_user.post(
        "/blueprint/glyphs/global/delete",
        json={"global_glyph_id": post_resp.json()["global_glyph_id"]},
    )
    assert del_resp.is_success, del_resp.text

    # Malformed expression remains a hard block_error
    sink_file_malformed = RoutableBlock(
        instance_id=BlockInstanceId("sink_file_malformed"),
        plugin=testPluginId,
        factory=BlockFactoryId("sink_file"),
        instance=BlockInstance(
            configuration_values=_config({"fname": "${x |}"}),
            input_ids={"data": BlockInstanceId("source_42")},
        ),
    )
    builder_malformed = BlueprintBuilder(
        blocks=[
            source_42,
            sink_file_malformed.model_copy(update={"instance_id": BlockInstanceId("sink_file")}),
        ]
    )
    response_malformed = backend_client_user.request(url="/blueprint/expand", method="put", json=builder_malformed.model_dump())
    assert response_malformed.is_success, response_malformed.text
    data_malformed = response_malformed.json()
    assert "sink_file" in data_malformed["block_errors"]

    # Set the global glyph that the builder's source_time block references
    post_resp = backend_client_user.post(
        "/blueprint/glyphs/global/post",
        json={"key": "basicExecuteGlobalGlyph", "value": "initial_value"},
    )
    assert post_resp.is_success, post_resp.text

    builder = _make_builder_full(tmpdir)
    save_req = BlueprintSaveCommand(builder=builder)
    save_resp = backend_client_user.post("/blueprint/create", json=save_req.model_dump())
    assert save_resp.is_success, save_resp.text
    blueprint_id = save_resp.json()["blueprint_id"]
    exec_response = backend_client_user.post("/run/create", json={"blueprint_id": blueprint_id})
    assert exec_response.is_success, exec_response.text
    response = RunCreateResponse(**exec_response.json())
    run_id = response.run_id
    assert response.attempt_count == 1
    ensure_completed_v2(backend_client_user, run_id, sleep=1, attempts=120)

    outputMain = pathlib.Path(f"{tmpdir}/output{run_id}.main.txt")
    assert outputMain.read_text() == "85"  # the output of 42 + 1 + 42, thats what the job is configured to do
    outputMain.unlink()
    status_resp = backend_client_user.get("/run/get", params={"run_id": run_id})
    assert status_resp.is_success, status_resp.text
    created_at = status_resp.json()["created_at"]
    outputTime = pathlib.Path(f"{tmpdir}/output{run_id}.time.txt")
    # Both submitDatetime and startDatetime equal created_at on the first run.
    # created_at is at higher precision than the second-resolution glyph values.
    # Use fromisoformat + replace to strip sub-second precision while preserving the UTC offset.
    created_at_sec = _dt.fromisoformat(created_at).replace(microsecond=0).isoformat()
    _time_line = outputTime.read_text()
    _time_parts = _time_line.split(";")
    assert _time_parts[0] == created_at_sec
    assert compare_with_tolerance(_time_parts[1], _dt.fromisoformat(created_at_sec))
    assert _time_parts[2] == "initial_value"
    assert _time_parts[3] == "local_glyph_value"
    outputTime.unlink()

    list_resp = backend_client_user.get("/run/list")
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
    update_resp = backend_client_user.post(
        "/blueprint/glyphs/global/post",
        json={"key": "basicExecuteGlobalGlyph", "value": "changed_value"},
    )
    assert update_resp.is_success, update_resp.text

    restart_resp = backend_client_user.post("/run/restart", json={"run_id": run_id, "attempt_count": 1})
    assert restart_resp.is_success, restart_resp.text
    data = restart_resp.json()
    assert data["run_id"] == run_id
    assert data["attempt_count"] == 2

    # Latest-attempt status reflects attempt 2
    status_resp = backend_client_user.get("/run/get", params={"run_id": run_id})
    assert status_resp.is_success, status_resp.text
    assert status_resp.json()["attempt_count"] == 2

    # Attempt 1 is still accessible explicitly
    status_1_resp = backend_client_user.get("/run/get", params={"run_id": run_id, "attempt_count": 1})
    assert status_1_resp.is_success, status_1_resp.text
    assert status_1_resp.json()["attempt_count"] == 1

    ensure_completed_v2(backend_client_user, run_id, sleep=1, attempts=120)
    assert outputMain.read_text() == "85"  # the output of 42 + 1 + 42, thats what the job is configured to do

    # After restart: submitDatetime must still equal original created_at; startDatetime
    # must reflect the restart's own created_at (attempt 2).  The global glyph value
    # must equal "initial_value" — the persisted context from attempt 1 triumphs over
    # the updated global value "changed_value".
    status_restarted_resp = backend_client_user.get("/run/get", params={"run_id": run_id})
    assert status_restarted_resp.is_success, status_restarted_resp.text
    created_at_restarted = _dt.fromisoformat(status_restarted_resp.json()["created_at"]).replace(microsecond=0).isoformat()
    _time_line_r = outputTime.read_text()
    _time_parts_r = _time_line_r.split(";")
    assert _time_parts_r[0] == created_at_sec
    assert compare_with_tolerance(_time_parts_r[1], _dt.fromisoformat(created_at_restarted), max_seconds=3)
    assert _time_parts_r[2] == "initial_value"
    assert _time_parts_r[3] == "local_glyph_value"

    get_resp = backend_client_user.get("/run/get", params={"run_id": run_id})
    assert get_resp.is_success, get_resp.text
    run_detail = get_resp.json()
    assert run_detail["outputs"] is not None
    available_tasks = [task_id for task_id, char in run_detail["outputs"]["outputs"].items() if char["is_available"]]
    assert isinstance(available_tasks, list)
    assert len(available_tasks) > 0
    assert run_detail["planned_block_ids"] == None
    assert run_detail["completed_block_ids"] == None

    logs_resp = backend_client_user.get("/run/logs", params={"run_id": run_id})
    assert logs_resp.is_success, logs_resp.text
    assert "zip" in logs_resp.headers["content-type"]
    with zipfile.ZipFile(io.BytesIO(logs_resp.content), "r") as zf:
        # NOTE dbEntity, gwState, gateway, controller, host0, host0.dsr, host0.shm, (host0.w1, host0.w2) x (logs, stdout, stderr)
        expected_log_count = 13
        assert len(zf.namelist()) == expected_log_count or os.getenv("FIAB_LOGSTDOUT", "nay") == "yea"

    # Clean up: delete the global glyph created in this test
    del_resp = backend_client_user.post(
        "/blueprint/glyphs/global/delete",
        json={"global_glyph_id": post_resp.json()["global_glyph_id"]},
    )
    assert del_resp.is_success, del_resp.text


def test_submit_job_v2_execute_missing_blueprint_id(backend_client_user: httpx.Client) -> None:
    """Omitting blueprint_id (required field) returns 422."""
    response = backend_client_user.post("/run/create", json={})
    assert response.status_code == 422


def test_submit_job_v2_execute_unknown_definition(backend_client_user: httpx.Client) -> None:
    """Referencing a non-existent Blueprint returns 404."""
    payload = {"blueprint_id": "does-not-exist"}
    response = backend_client_user.post("/run/create", json=payload)
    assert response.status_code == 404


def test_submit_job_v2_read_status_not_found(backend_client_user: httpx.Client) -> None:
    """GET /execution/get with unknown run_id returns 404."""
    resp = backend_client_user.get("/run/get", params={"run_id": "nonexistent-exec-id"})
    assert resp.status_code == 404


def test_submit_job_v2_restart_not_found(backend_client_user: httpx.Client) -> None:
    """POST /execution/restart with unknown run_id returns 404."""
    resp = backend_client_user.post("/run/restart", json={"run_id": "nonexistent-exec-id", "attempt_count": 1})
    assert resp.status_code == 404


def test_list_available_glyphs(backend_client_user: httpx.Client) -> None:
    """The glyphs/list endpoint returns intrinsic and global glyphs with correct shape."""
    # Filter to intrinsic only
    response = backend_client_user.get("/blueprint/glyphs/list", params={"glyph_type": "intrinsic"})
    assert response.is_success, response.text
    data = response.json()
    assert "glyphs" in data
    assert "total" in data
    returned_names = {item["name"] for item in data["glyphs"]}
    expected_names = set(get_args(AvailableIntrinsicGlyphs))
    assert returned_names == expected_names
    for item in data["glyphs"]:
        assert item["glyph_type"] == "intrinsic"
        assert "display_name" in item
        assert "valueExample" in item
        assert item["display_name"]
        assert item["valueExample"]

    # Global glyphs list reflects whatever has been posted by other tests; record the baseline
    global_resp = backend_client_user.get("/blueprint/glyphs/list", params={"glyph_type": "global"})
    assert global_resp.is_success, global_resp.text
    global_data = global_resp.json()
    initial_total = global_data["total"]
    assert isinstance(global_data["glyphs"], list)

    # Post a new global glyph and verify the count increases and the glyph appears
    post_resp = backend_client_user.post(
        "/blueprint/glyphs/global/post",
        json={"key": "listGlyphsGlobalGlyph", "value": "list_test_value"},
    )
    assert post_resp.is_success, post_resp.text
    posted = post_resp.json()
    assert posted["key"] == "listGlyphsGlobalGlyph"
    assert posted["value"] == "list_test_value"
    assert "global_glyph_id" in posted
    assert posted["glyph_type"] == "global"

    global_resp2 = backend_client_user.get("/blueprint/glyphs/list", params={"glyph_type": "global"})
    assert global_resp2.is_success, global_resp2.text
    global_data2 = global_resp2.json()
    assert global_data2["total"] == initial_total + 1
    keys = {item["key"] for item in global_data2["glyphs"]}
    assert "listGlyphsGlobalGlyph" in keys
    for item in global_data2["glyphs"]:
        assert item["glyph_type"] == "global"

    # Retrieve by key filter via list endpoint (replaces the old GET by id)
    key_resp = backend_client_user.get("/blueprint/glyphs/list", params={"glyph_key": "listGlyphsGlobalGlyph"})
    assert key_resp.is_success, key_resp.text
    key_data = key_resp.json()
    assert any(g["key"] == "listGlyphsGlobalGlyph" and g["global_glyph_id"] == posted["global_glyph_id"] for g in key_data["glyphs"])

    # Non-admin users must not be able to create public global glyphs
    public_resp = backend_client_user.post(
        "/blueprint/glyphs/global/post",
        json={"key": "shouldBeRejected", "value": "v", "public": True, "overriddable": True},
    )
    assert public_resp.status_code == 403

    # Clean up: delete the glyph created in this test
    delete_resp = backend_client_user.post(
        "/blueprint/glyphs/global/delete",
        json={"global_glyph_id": posted["global_glyph_id"]},
    )
    assert delete_resp.is_success, delete_resp.text


def test_list_glyph_functions(backend_client_user: httpx.Client) -> None:
    """The glyphs/functions endpoint returns all registered custom functions with name and description."""
    from forecastbox.domain.glyphs.jinja_interpolation import CUSTOM_FUNCTIONS

    response = backend_client_user.get("/blueprint/glyphs/functions")
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


def test_blueprint_expand_failure_01(backend_client_user: httpx.Client) -> None:
    """Source has an invalid factory; transform referencing it must not generate its own error."""
    bad_source = RoutableBlock(
        instance_id=BlockInstanceId("bad_source"),
        plugin=testPluginId,
        factory=BlockFactoryId("nonexistent_factory"),
        instance=BlockInstance(
            configuration_values={},
            input_ids={},
        ),
    )
    good_transform = RoutableBlock(
        instance_id=BlockInstanceId("good_transform"),
        plugin=testPluginId,
        factory=BlockFactoryId("transform_increment"),
        instance=BlockInstance(
            configuration_values=_config({"amount": "1"}),
            input_ids={"a": BlockInstanceId("bad_source")},
        ),
    )
    builder = BlueprintBuilder(
        blocks=[
            bad_source,
            good_transform,
        ]
    )
    response = backend_client_user.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert response.is_success, response.text
    block_errors = response.json()["block_errors"]
    assert "bad_source" in block_errors
    assert "good_transform" not in block_errors


def test_blueprint_expand_failure_02(backend_client_user: httpx.Client) -> None:
    """Transform declares an input id that does not exist in the blueprint; only the transform errors."""
    source_42 = RoutableBlock(
        instance_id=BlockInstanceId("source_42"),
        plugin=testPluginId,
        factory=BlockFactoryId("source_42"),
        instance=BlockInstance(
            configuration_values={},
            input_ids={},
        ),
    )
    bad_transform = RoutableBlock(
        instance_id=BlockInstanceId("bad_transform"),
        plugin=testPluginId,
        factory=BlockFactoryId("transform_increment"),
        instance=BlockInstance(
            configuration_values=_config({"amount": "1"}),
            input_ids={"a": BlockInstanceId("nonexistent_block")},
        ),
    )
    builder = BlueprintBuilder(
        blocks=[
            source_42,
            bad_transform,
        ]
    )
    response = backend_client_user.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert response.is_success, response.text
    block_errors = response.json()["block_errors"]
    assert "source_42" not in block_errors
    assert "bad_transform" in block_errors


def test_blueprint_expand_failure_03(backend_client_user: httpx.Client) -> None:
    """Bad source and transform with a non-existent input id both report independent errors."""
    bad_source = RoutableBlock(
        instance_id=BlockInstanceId("bad_source"),
        plugin=testPluginId,
        factory=BlockFactoryId("nonexistent_factory"),
        instance=BlockInstance(
            configuration_values={},
            input_ids={},
        ),
    )
    bad_transform = RoutableBlock(
        instance_id=BlockInstanceId("bad_transform"),
        plugin=testPluginId,
        factory=BlockFactoryId("transform_increment"),
        instance=BlockInstance(
            configuration_values=_config({"amount": "1"}),
            input_ids={"a": BlockInstanceId("nonexistent_block")},
        ),
    )
    builder = BlueprintBuilder(
        blocks=[
            bad_source,
            bad_transform,
        ]
    )
    response = backend_client_user.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert response.is_success, response.text
    block_errors = response.json()["block_errors"]
    assert "bad_source" in block_errors
    assert "bad_transform" in block_errors

    # we now verify that the missing-glyph warning for transform is reported, despite parent being invalid
    bad_transform2 = RoutableBlock(
        instance_id=BlockInstanceId("bad_transform2"),
        plugin=testPluginId,
        factory=BlockFactoryId("transform_increment"),
        instance=BlockInstance(
            configuration_values=_config({"amount": "${nonExistentGlyph}"}),
            input_ids={"a": BlockInstanceId("bad_source")},
        ),
    )
    builder = BlueprintBuilder(
        blocks=[
            bad_source,
            bad_transform2.model_copy(update={"instance_id": BlockInstanceId("bad_transform")}),
        ]
    )
    response = backend_client_user.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert response.is_success, response.text
    block_errors = response.json()["block_errors"]
    assert "bad_source" in block_errors
    missing_glyphs = response.json()["missing_glyphs"]
    assert "bad_transform" in missing_glyphs
    assert missing_glyphs["bad_transform"]["amount"] == ["nonExistentGlyph"]


def test_blueprint_expand_failure_04_invalid_configuration_type(backend_client_user: httpx.Client) -> None:
    """Type conversion errors are reported by backend validation before plugin validation."""
    source_42 = RoutableBlock(
        instance_id=BlockInstanceId("source_42"),
        plugin=testPluginId,
        factory=BlockFactoryId("source_42"),
        instance=BlockInstance(
            configuration_values={},
            input_ids={},
        ),
    )
    bad_transform = RoutableBlock(
        instance_id=BlockInstanceId("bad_transform"),
        plugin=testPluginId,
        factory=BlockFactoryId("transform_increment"),
        instance=BlockInstance(
            configuration_values=_config({"amount": "not_an_int"}),
            input_ids={"a": BlockInstanceId("source_42")},
        ),
    )
    builder = BlueprintBuilder(
        blocks=[
            source_42,
            bad_transform,
        ]
    )
    response = backend_client_user.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert response.is_success, response.text
    block_errors = response.json()["block_errors"]
    assert "bad_transform" in block_errors
    assert any("Invalid value for configuration option 'amount': expected int" in message for message in block_errors["bad_transform"])


def test_blueprint_expand_missing_configuration_is_not_error(backend_client_user: httpx.Client) -> None:
    """Missing values are omitted during validation instead of producing hard errors."""
    source_42 = RoutableBlock(
        instance_id=BlockInstanceId("source_42"),
        plugin=testPluginId,
        factory=BlockFactoryId("source_42"),
        instance=BlockInstance(
            configuration_values={},
            input_ids={},
        ),
    )
    transform_missing_amount = RoutableBlock(
        instance_id=BlockInstanceId("transform_missing_amount"),
        plugin=testPluginId,
        factory=BlockFactoryId("transform_increment"),
        instance=BlockInstance(
            configuration_values={},
            input_ids={"a": BlockInstanceId("source_42")},
        ),
    )
    builder = BlueprintBuilder(
        blocks=[
            source_42,
            transform_missing_amount,
        ]
    )
    response = backend_client_user.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert response.is_success, response.text
    block_errors = response.json()["block_errors"]
    assert "transform_missing_amount" not in block_errors


def test_blueprint_create_and_update_allow_missing_configuration_values(backend_client_user: httpx.Client) -> None:
    """Draft blueprints with missing config can be saved, but compilation stays strict."""
    source_42 = RoutableBlock(
        instance_id=BlockInstanceId("source_42"),
        plugin=testPluginId,
        factory=BlockFactoryId("source_42"),
        instance=BlockInstance(
            configuration_values={},
            input_ids={},
        ),
    )
    transform_missing_amount = RoutableBlock(
        instance_id=BlockInstanceId("transform_missing_amount"),
        plugin=testPluginId,
        factory=BlockFactoryId("transform_increment"),
        instance=BlockInstance(
            configuration_values={},
            input_ids={"a": BlockInstanceId("source_42")},
        ),
    )
    builder = BlueprintBuilder(
        blocks=[
            source_42,
            transform_missing_amount,
        ]
    )

    create_response = backend_client_user.post("/blueprint/create", json=BlueprintSaveCommand(builder=builder).model_dump())
    assert create_response.is_success, create_response.text
    saved = create_response.json()
    update_response = backend_client_user.post(
        "/blueprint/update",
        json={
            **BlueprintSaveCommand(builder=builder).model_dump(),
            "blueprint_id": saved["blueprint_id"],
            "version": saved["version"],
        },
    )
    assert update_response.is_success, update_response.text


def test_blueprint_composite_glyph_expand(tmpdir: Any, backend_client_user: httpx.Client) -> None:
    """A local glyph value that references other glyphs is expanded end-to-end.

    Covers:
    - validate_expand resolves composite glyph values and reflects them in resolved_configuration_options
    - A circular glyph reference is reported as a global_error
    """
    # Post a global glyph that the composite local glyph will reference
    post_resp = backend_client_user.post(
        "/blueprint/glyphs/global/post",
        json={"key": "compositeExpandGlobalPart", "value": "global_part"},
    )
    assert post_resp.is_success, post_resp.text

    # Build a blueprint whose local glyph composes the global part and a known intrinsic
    source_text = RoutableBlock(
        instance_id=BlockInstanceId("source_text"),
        plugin=testPluginId,
        factory=BlockFactoryId("source_text"),
        instance=BlockInstance(
            configuration_values=_config({"text": "${compositeLocalGlyph}"}),
            input_ids={},
        ),
    )
    sink_file = RoutableBlock(
        instance_id=BlockInstanceId("sink_file"),
        plugin=testPluginId,
        factory=BlockFactoryId("sink_file"),
        instance=BlockInstance(
            configuration_values=_config({"fname": f"{tmpdir}/composite_expand_output.txt"}),
            input_ids={"data": BlockInstanceId("source_text")},
        ),
    )
    builder = BlueprintBuilder(
        blocks=[
            source_text,
            sink_file,
        ],
        local_glyphs={"compositeLocalGlyph": "${compositeExpandGlobalPart}/${runId}"},
    )
    response = backend_client_user.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert response.is_success, response.text
    data = response.json()
    assert len(data["global_errors"]) == 0
    assert len(data["block_errors"]) == 0
    # Fetch the intrinsic runId example to verify the fully-resolved composite value
    glyphs_resp = backend_client_user.get("/blueprint/glyphs/list", params={"glyph_type": "intrinsic"})
    assert glyphs_resp.is_success, glyphs_resp.text
    run_id_example = next(g["valueExample"] for g in glyphs_resp.json()["glyphs"] if g["name"] == "runId")
    resolved_text = data["resolved_configuration_options"]["source_text"]["text"]
    assert resolved_text == f"global_part/{run_id_example}", f"Unexpected: {resolved_text!r}"

    # A local glyph that references an unknown glyph surfaces as a missing_glyph warning,
    # even though the composite glyph key itself is known.
    sink_file_missing = RoutableBlock(
        instance_id=BlockInstanceId("sink_file_missing"),
        plugin=testPluginId,
        factory=BlockFactoryId("sink_file"),
        instance=BlockInstance(
            configuration_values=_config({"fname": f"{tmpdir}/output.txt"}),
            input_ids={"data": BlockInstanceId("source_text")},
        ),
    )
    builder_nested_unknown = BlueprintBuilder(
        blocks=[
            source_text,
            sink_file_missing.model_copy(update={"instance_id": BlockInstanceId("sink_file")}),
        ],
        local_glyphs={"compositeLocalGlyph": "${compositeExpandGlobalPart}/${notDefinedAnywhere}"},
    )
    response_nested = backend_client_user.request(url="/blueprint/expand", method="put", json=builder_nested_unknown.model_dump())
    assert response_nested.is_success, response_nested.text
    nested_data = response_nested.json()
    assert "source_text" not in nested_data["block_errors"]
    assert "source_text" in nested_data["missing_glyphs"]
    assert nested_data["missing_glyphs"]["source_text"]["text"] == ["notDefinedAnywhere"]

    # A builder with a circular glyph reference must report a global_error
    builder_cyclic = BlueprintBuilder(
        blocks=[
            source_text,
            sink_file,
        ],
        local_glyphs={"compositeLocalGlyph": "${compositeLocalGlyph}/suffix"},
    )
    response_cyclic = backend_client_user.request(url="/blueprint/expand", method="put", json=builder_cyclic.model_dump())
    assert response_cyclic.is_success, response_cyclic.text
    cyclic_data = response_cyclic.json()
    assert len(cyclic_data["global_errors"]) > 0
    assert any("circular" in err.lower() or "cycle" in err.lower() for err in cyclic_data["global_errors"])

    # A local glyph whose value contains a jinja filter expression referencing an intrinsic
    # glyph must be fully evaluated via expand_glyph_values (regression test for the
    # fix that extended expand_glyph_values to handle jinja expressions, not just plain ${var}).
    glyphs_resp2 = backend_client_user.get("/blueprint/glyphs/list", params={"glyph_type": "intrinsic"})
    assert glyphs_resp2.is_success, glyphs_resp2.text
    submit_example = next(g["valueExample"] for g in glyphs_resp2.json()["glyphs"] if g["name"] == "submitDatetime")
    # floor_day of the example value: strip time component
    expected_floored = submit_example[:10] + "T00:00:00+00:00"
    source_jinja = RoutableBlock(
        instance_id=BlockInstanceId("source_jinja"),
        plugin=testPluginId,
        factory=BlockFactoryId("source_text"),
        instance=BlockInstance(
            configuration_values=_config({"text": "${jinjaFilterGlyph}"}),
            input_ids={},
        ),
    )
    builder_jinja = BlueprintBuilder(
        blocks=[
            source_jinja,
        ],
        local_glyphs={"jinjaFilterGlyph": "${submitDatetime | floor_day}"},
    )
    response_jinja = backend_client_user.request(url="/blueprint/expand", method="put", json=builder_jinja.model_dump())
    assert response_jinja.is_success, response_jinja.text
    jinja_data = response_jinja.json()
    assert len(jinja_data["global_errors"]) == 0, jinja_data["global_errors"]
    assert len(jinja_data["block_errors"]) == 0, jinja_data["block_errors"]
    resolved_jinja = jinja_data["resolved_configuration_options"]["source_jinja"]["text"]
    assert resolved_jinja == expected_floored, f"Expected {expected_floored!r}, got {resolved_jinja!r}"

    # Clean up the global glyph created in this test
    del_resp = backend_client_user.post(
        "/blueprint/glyphs/global/delete",
        json={"global_glyph_id": post_resp.json()["global_glyph_id"]},
    )
    assert del_resp.is_success, del_resp.text


def test_blueprint_jinja_interpolation_expand(backend_client_user: httpx.Client) -> None:
    """Jinja interpolation is validated and resolved via the /expand endpoint.

    Covers:
    - A malformed jinja expression such as ``${startDatetime | this-is-no-filter}`` results in
      block_errors (the expand endpoint always returns 200; callers inspect block_errors).
      Jinja2 parses ``this-is-no-filter`` as subtraction so the tokens ``is``, ``no``, ``filter``
      are treated as unknown glyph variables and reported accordingly.
    - A well-formed pure-jinja expression ``${(datetime(2024, 1, 15) + timedelta(days=1)) | floor_day}``
      (using only registered globals/filters, no glyph variables) is evaluated correctly and its
      resolved value appears in resolved_configuration_options.
    """
    # Malformed: hyphens make `this-is-no-filter` parsed as subtraction; the resulting "glyph"
    # names (is, no, filter) are unknown, so the block gets a missing_glyph entry.
    source_malformed = RoutableBlock(
        instance_id=BlockInstanceId("source_malformed"),
        plugin=testPluginId,
        factory=BlockFactoryId("source_text"),
        instance=BlockInstance(
            configuration_values=_config({"text": "${startDatetime | this-is-no-filter}"}),
            input_ids={},
        ),
    )
    builder_malformed = BlueprintBuilder(
        blocks=[
            source_malformed.model_copy(update={"instance_id": BlockInstanceId("source_text")}),
        ]
    )
    response = backend_client_user.request(url="/blueprint/expand", method="put", json=builder_malformed.model_dump())
    assert response.is_success, response.text
    data = response.json()
    assert "source_text" not in data["block_errors"], f"Expected no block error, got: {data['block_errors']}"
    assert "source_text" in data["missing_glyphs"], f"Expected missing_glyphs entry for unknown glyph names: {data}"

    # Well-formed: pure jinja arithmetic using registered globals (datetime, timedelta) and filter (floor_day).
    # Parentheses are required because Jinja2's | (filter) has higher precedence than +.
    # (datetime(2024, 1, 15) + timedelta(days=1)) | floor_day = 2024-01-16T00:00:00
    source_wellformed = RoutableBlock(
        instance_id=BlockInstanceId("source_wellformed"),
        plugin=testPluginId,
        factory=BlockFactoryId("source_text"),
        instance=BlockInstance(
            configuration_values=_config({"text": "${(datetime(2024, 1, 15) + timedelta(days=1)) | floor_day}"}),
            input_ids={},
        ),
    )
    builder_wellformed = BlueprintBuilder(
        blocks=[
            source_wellformed.model_copy(update={"instance_id": BlockInstanceId("source_text")}),
        ]
    )
    response = backend_client_user.request(url="/blueprint/expand", method="put", json=builder_wellformed.model_dump())
    assert response.is_success, response.text
    data = response.json()
    assert len(data["block_errors"]) == 0, data["block_errors"]
    resolved = data["resolved_configuration_options"]["source_text"]["text"]
    assert resolved == "2024-01-16T00:00:00", f"Unexpected resolved value: {resolved!r}"


def test_blueprint_composite_glyph_execute(tmpdir: Any, backend_client_user: httpx.Client) -> None:
    """Execute a blueprint whose config value is resolved via a composite local glyph.

    The composite glyph ``${compositeExecGlobalPart}/${runId}`` must be fully expanded
    at runtime and the output must reflect the expanded value.
    On restart the runId component must remain stable (runId is preserved, not pinned).
    """
    post_resp = backend_client_user.post(
        "/blueprint/glyphs/global/post",
        json={"key": "compositeExecGlobalPart", "value": "exec_global"},
    )
    assert post_resp.is_success, post_resp.text

    source_text = RoutableBlock(
        instance_id=BlockInstanceId("source_text"),
        plugin=testPluginId,
        factory=BlockFactoryId("source_text"),
        instance=BlockInstance(
            configuration_values=_config({"text": "${compositeLocalGlyphExec}"}),
            input_ids={},
        ),
    )
    sink_file = RoutableBlock(
        instance_id=BlockInstanceId("sink_file"),
        plugin=testPluginId,
        factory=BlockFactoryId("sink_file"),
        instance=BlockInstance(
            configuration_values=_config({"fname": f"{tmpdir}/composite_exec_output.txt"}),
            input_ids={"data": BlockInstanceId("source_text")},
        ),
    )
    sink_file_2 = RoutableBlock(
        instance_id=BlockInstanceId("sink_file_2"),
        plugin=testPluginId,
        factory=BlockFactoryId("sink_file"),
        instance=BlockInstance(
            configuration_values=_config({"fname": f"{tmpdir}/composite_exec_output_2.txt"}),
            input_ids={"data": BlockInstanceId("source_text")},
        ),
    )
    builder = BlueprintBuilder(
        blocks=[
            source_text,
            sink_file,
            sink_file_2,
        ],
        local_glyphs={"compositeLocalGlyphExec": "${compositeExecGlobalPart}/${runId}"},
    )
    save_resp = backend_client_user.post("/blueprint/create", json=BlueprintSaveCommand(builder=builder).model_dump())
    assert save_resp.is_success, save_resp.text
    blueprint_id = save_resp.json()["blueprint_id"]

    exec_resp = backend_client_user.post("/run/create", json={"blueprint_id": blueprint_id})
    assert exec_resp.is_success, exec_resp.text
    run_id = exec_resp.json()["run_id"]

    ensure_completed_v2(backend_client_user, run_id, sleep=1, attempts=120)

    # Verify compilation detail is accessible and has the expected number of tasks
    detail_resp = backend_client_user.get("/run/getCompilationDetail", params={"run_id": run_id})
    assert detail_resp.is_success, detail_resp.text
    detail = CompilationDetailResponse.model_validate(detail_resp.json())
    assert len(detail.tasks) == 3, f"Expected 3 tasks, got {len(detail.tasks)}: {detail.tasks}"
    assert {task.block for task in detail.tasks} == {
        BlockInstanceId("source_text"),
        BlockInstanceId("sink_file"),
        BlockInstanceId("sink_file_2"),
    }

    output = pathlib.Path(f"{tmpdir}/composite_exec_output.txt")
    content = output.read_text()
    # Content must be "exec_global/<run_id>"
    assert content == f"exec_global/{run_id}", f"Unexpected output: {content!r}"
    output.unlink()

    output_2 = pathlib.Path(f"{tmpdir}/composite_exec_output_2.txt")
    content_2 = output_2.read_text()
    assert content_2 == f"exec_global/{run_id}", f"Unexpected output: {content_2!r}"
    output_2.unlink()

    # Clean up the global glyph created in this test
    del_resp = backend_client_user.post(
        "/blueprint/glyphs/global/delete",
        json={"global_glyph_id": post_resp.json()["global_glyph_id"]},
    )
    assert del_resp.is_success, del_resp.text


# ---------------------------------------------------------------------------
# Run delete and output-content tests
# ---------------------------------------------------------------------------


def _make_builder_source_and_sink(tmpdir: str) -> BlueprintBuilder:
    """Minimal two-block blueprint: source_42 → sink_file.

    Produces exactly one non-sink task (source_42) whose output is the integer 42,
    and one sink task (sink_file).
    """
    source_42 = RoutableBlock(
        instance_id=BlockInstanceId("source_42"),
        plugin=testPluginId,
        factory=BlockFactoryId("source_42"),
        instance=BlockInstance(
            configuration_values={},
            input_ids={},
        ),
    )
    sink = RoutableBlock(
        instance_id=BlockInstanceId("sink"),
        plugin=testPluginId,
        factory=BlockFactoryId("sink_file"),
        instance=BlockInstance(
            configuration_values=_config({"fname": f"{tmpdir}/output_${{runId}}.txt"}),
            input_ids={"data": BlockInstanceId("source_42")},
        ),
    )
    return BlueprintBuilder(
        blocks=[
            source_42,
            sink.model_copy(update={"instance_id": BlockInstanceId("my_sink")}),
        ]
    )


def _make_builder_source_and_two_sinks(tmpdir: str) -> BlueprintBuilder:
    """Blueprint with source_42 → sink_file and source_42 → sink_image."""
    source_42 = RoutableBlock(
        instance_id=BlockInstanceId("source_42"),
        plugin=testPluginId,
        factory=BlockFactoryId("source_42"),
        instance=BlockInstance(
            configuration_values={},
            input_ids={},
        ),
    )
    sink_file = RoutableBlock(
        instance_id=BlockInstanceId("sink_file"),
        plugin=testPluginId,
        factory=BlockFactoryId("sink_file"),
        instance=BlockInstance(
            configuration_values=_config({"fname": f"{tmpdir}/output_${{runId}}.txt"}),
            input_ids={"data": BlockInstanceId("source_42")},
        ),
    )
    sink_image = RoutableBlock(
        instance_id=BlockInstanceId("sink_image"),
        plugin=testPluginId,
        factory=BlockFactoryId("sink_image"),
        instance=BlockInstance(
            configuration_values={},
            input_ids={"data": BlockInstanceId("source_42")},
        ),
    )
    return BlueprintBuilder(
        blocks=[
            source_42,
            sink_file.model_copy(update={"instance_id": BlockInstanceId("my_sink")}),
            sink_image.model_copy(update={"instance_id": BlockInstanceId("my_image_sink")}),
        ]
    )


def test_run_delete_not_found(backend_client_user: httpx.Client) -> None:
    """POST /run/delete with a non-existent run_id returns 404."""
    resp = backend_client_user.post("/run/delete", json={"run_id": "nonexistent-run-id", "attempt_count": 1})
    assert resp.status_code == 404


def test_run_delete_attempt_conflict(backend_client_user: httpx.Client) -> None:
    """POST /run/delete with a mismatched attempt_count returns 409."""
    builder = _make_builder_source_only()
    save_resp = backend_client_user.post("/blueprint/create", json=BlueprintSaveCommand(builder=builder).model_dump())
    assert save_resp.is_success, save_resp.text
    blueprint_id = save_resp.json()["blueprint_id"]

    run_resp = backend_client_user.post("/run/create", json={"blueprint_id": blueprint_id})
    assert run_resp.is_success, run_resp.text
    run_id = run_resp.json()["run_id"]
    attempt_count = run_resp.json()["attempt_count"]

    del_resp = backend_client_user.post("/run/delete", json={"run_id": run_id, "attempt_count": attempt_count + 1})
    assert del_resp.status_code == 409


def test_run_restart_attempt_conflict(backend_client_user: httpx.Client) -> None:
    """POST /run/restart with a mismatched attempt_count returns 409."""
    builder = _make_builder_source_only()
    save_resp = backend_client_user.post("/blueprint/create", json=BlueprintSaveCommand(builder=builder).model_dump())
    assert save_resp.is_success, save_resp.text
    blueprint_id = save_resp.json()["blueprint_id"]

    run_resp = backend_client_user.post("/run/create", json={"blueprint_id": blueprint_id})
    assert run_resp.is_success, run_resp.text
    run_id = run_resp.json()["run_id"]
    attempt_count = run_resp.json()["attempt_count"]

    restart_resp = backend_client_user.post("/run/restart", json={"run_id": run_id, "attempt_count": attempt_count + 1})
    assert restart_resp.status_code == 409


def test_run_delete_ok(tmpdir: Any, backend_client_user: httpx.Client) -> None:
    """Create a run, wait for completion, delete it, verify it disappears."""
    builder = _make_builder_source_and_sink(tmpdir)
    save_resp = backend_client_user.post("/blueprint/create", json=BlueprintSaveCommand(builder=builder).model_dump())
    assert save_resp.is_success, save_resp.text
    blueprint_id = save_resp.json()["blueprint_id"]

    run_resp = backend_client_user.post("/run/create", json={"blueprint_id": blueprint_id})
    assert run_resp.is_success, run_resp.text
    run_id = run_resp.json()["run_id"]
    attempt_count = run_resp.json()["attempt_count"]

    ensure_completed_v2(backend_client_user, run_id, sleep=1, attempts=120)

    total_before = backend_client_user.get("/run/list").raise_for_status().json()["total"]

    del_resp = backend_client_user.post("/run/delete", json={"run_id": run_id, "attempt_count": attempt_count})
    assert del_resp.is_success, del_resp.text

    # Deleted run is no longer accessible
    get_resp = backend_client_user.get("/run/get", params={"run_id": run_id})
    assert get_resp.status_code == 404

    # And no longer appears in the list
    list_after = backend_client_user.get("/run/list").raise_for_status().json()
    assert list_after["total"] == total_before - 1
    assert run_id not in [r["run_id"] for r in list_after["runs"]]


def test_run_output_content(tmpdir: Any, backend_client_user: httpx.Client) -> None:
    """Execute a run, wait for completion, then retrieve output content via outputContent."""
    builder = _make_builder_source_and_two_sinks(tmpdir)
    save_resp = backend_client_user.post("/blueprint/create", json=BlueprintSaveCommand(builder=builder).model_dump())
    assert save_resp.is_success, save_resp.text
    blueprint_id = save_resp.json()["blueprint_id"]

    run_resp = backend_client_user.post("/run/create", json={"blueprint_id": blueprint_id})
    assert run_resp.is_success, run_resp.text
    run_id = run_resp.json()["run_id"]

    ensure_completed_v2(backend_client_user, run_id, sleep=1, attempts=120)

    get_resp = backend_client_user.get("/run/get", params={"run_id": run_id})
    assert get_resp.is_success, get_resp.text
    run_detail = get_resp.json()
    assert run_detail["outputs"] is not None
    output_entries = run_detail["outputs"]["outputs"]
    available_tasks = [task_id for task_id, char in output_entries.items() if char["is_available"]]
    assert len(available_tasks) > 0

    # Cascade only exposes sink tasks as ext_outputs; our blueprint has two sinks.
    # Task IDs encode the runtime function name: fiab_plugin_test.runtime.sink_file:<hash>
    # and fiab_plugin_test.runtime.sink_image:<hash>
    sink_file_tasks = [t for t in available_tasks if "sink_file" in t]
    assert len(sink_file_tasks) == 1, f"Expected exactly one sink_file task, got: {available_tasks}"
    sink_file_task_id = sink_file_tasks[0]

    sink_image_tasks = [t for t in available_tasks if "sink_image" in t]
    assert len(sink_image_tasks) == 1, f"Expected exactly one sink_image task, got: {available_tasks}"
    sink_image_task_id = sink_image_tasks[0]

    # Verify original_block points to the correct block instance IDs from the blueprint
    assert output_entries[sink_file_task_id]["original_block"] == "my_sink"
    assert output_entries[sink_image_task_id]["original_block"] == "my_image_sink"

    # Verify declared mime_type matches the actual content-type returned by outputContent
    assert output_entries[sink_file_task_id]["mime_type"] == "text/plain"
    assert output_entries[sink_image_task_id]["mime_type"] == "image/png"

    content_resp = backend_client_user.get(
        "/run/outputContent",
        params={"run_id": run_id, "dataset_id": sink_file_task_id},
        # macOS has a delayed first cloudpickle import under forking; give it more time
        timeout=40.0 if sys.platform == "darwin" else None,
    )
    assert content_resp.is_success, content_resp.text
    # The backend may add charset to text/plain; use startswith for robustness
    assert content_resp.headers.get("content-type", "").startswith("text/plain")
    assert content_resp.content.decode("ascii").startswith("file://")

    if sys.platform == "darwin":
        # Re-fetch without an extended timeout to confirm the import delay was a one-off
        content_resp2 = backend_client_user.get("/run/outputContent", params={"run_id": run_id, "dataset_id": sink_file_task_id})
        assert content_resp2.headers.get("content-type", "").startswith("text/plain")
        assert content_resp2.content.decode("ascii").startswith("file://")

    image_resp = backend_client_user.get(
        "/run/outputContent",
        params={"run_id": run_id, "dataset_id": sink_image_task_id},
    )
    assert image_resp.is_success, image_resp.text
    assert image_resp.headers.get("content-type", "").startswith("image/png")
    assert len(image_resp.content) > 0


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
def test_gateway_restart_with_in_progress_job(backend_client_user: httpx.Client) -> None:
    """Kill the gateway while a job is active; verify the expected status transitions."""
    sleeper = RoutableBlock(
        instance_id=BlockInstanceId("sleeper"),
        plugin=testPluginId,
        factory=BlockFactoryId("source_sleep"),
        instance=BlockInstance(
            configuration_values=_config({"text": "hello", "duration": "30"}),
            input_ids={},
        ),
    )
    sink = RoutableBlock(
        instance_id=BlockInstanceId("sink"),
        plugin=testPluginId,
        factory=BlockFactoryId("sink_file"),
        instance=BlockInstance(
            configuration_values=_config({"fname": "/dev/null"}),
            input_ids={"data": BlockInstanceId("sleeper")},
        ),
    )
    builder = BlueprintBuilder(
        blocks=[
            sleeper,
            sink.model_copy(update={"instance_id": BlockInstanceId("sleeper_sink")}),
        ]
    )
    save_resp = backend_client_user.post("/blueprint/create", json=BlueprintSaveCommand(builder=builder).model_dump())
    assert save_resp.is_success, save_resp.text
    blueprint_id = save_resp.json()["blueprint_id"]

    run_resp = backend_client_user.post("/run/create", json={"blueprint_id": blueprint_id})
    assert run_resp.is_success, run_resp.text
    run_id = run_resp.json()["run_id"]

    _wait_until_running(backend_client_user, run_id)

    # TODO this leaves the workers hanging. We need some solution to collect them properly
    kill_resp = backend_client_user.post("/gateway/kill")
    assert kill_resp.is_success, kill_resp.text

    # Polling while the gateway is down returns "unknown"
    status_resp = backend_client_user.get("/run/get", params={"run_id": run_id}, timeout=30)
    assert status_resp.is_success, status_resp.text
    assert status_resp.json()["status"] == "unknown"
    assert "failed to communicate with gateway" in status_resp.json()["error"]

    start_resp = backend_client_user.post("/gateway/start")
    assert start_resp.is_success, start_resp.text

    # After the gateway restarts (fresh, empty), the job is unknown to it → "evicted from gateway"
    def poll_evicted() -> Any:
        resp = backend_client_user.get("/run/get", params={"run_id": run_id}, timeout=10)
        assert resp.is_success, resp.text
        return resp.json()

    def verify_evicted(data: Any) -> bool | None:
        if data["status"] == "failed" and data.get("error") == "evicted from gateway":
            return True
        if data["status"] == "completed":
            raise RuntimeError(f"Unexpected terminal status: {data}")
        return None

    retry_until(poll_evicted, verify_evicted, attempts=30, sleep=1.0, error_msg=f"Run {run_id} never reached 'evicted from gateway'")


def test_blueprint_artifact_execute(tmpdir: Any, backend_client_user: httpx.Client) -> None:
    """Execute a blueprint whose source reads the size of a runtime-downloaded artifact checkpoint."""
    # Verify that the small checkpoint has not been downloaded yet
    response = backend_client_user.get("/artifacts/list_models").raise_for_status()
    models = response.json()
    small_model = next(
        (
            m
            for m in models
            if m["composite_id"]["artifact_store_id"] == fake_artifact_store_id
            and m["composite_id"]["artifact_local_id"] == test_blueprint_artifact_id
        ),
        None,
    )
    assert small_model is not None, "Small test checkpoint not found in model list"
    assert small_model["is_available"] == False, "Small checkpoint must not be downloaded before this test runs"

    checkpoint_composite_id = f"{fake_artifact_store_id}:{test_blueprint_artifact_id}"

    source_filesize = RoutableBlock(
        instance_id=BlockInstanceId("source_filesize"),
        plugin=testPluginId,
        factory=BlockFactoryId("source_filesize"),
        instance=BlockInstance(
            configuration_values=_config({"checkpoint": checkpoint_composite_id}),
            input_ids={},
        ),
    )
    sink = RoutableBlock(
        instance_id=BlockInstanceId("sink"),
        plugin=testPluginId,
        factory=BlockFactoryId("sink_file"),
        instance=BlockInstance(
            configuration_values=_config({"fname": f"{tmpdir}/filesize_${{runId}}.txt"}),
            input_ids={"data": BlockInstanceId("source_filesize")},
        ),
    )
    builder = BlueprintBuilder(
        blocks=[
            source_filesize,
            sink.model_copy(update={"instance_id": BlockInstanceId("sink_file")}),
        ]
    )

    # Validate blueprint via expand
    expand_resp = backend_client_user.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert expand_resp.is_success, expand_resp.text
    block_errors = expand_resp.json().get("block_errors", {})
    assert not block_errors, f"Blueprint validation errors: {block_errors}"
    global_errors = expand_resp.json().get("global_errors", [])
    assert not global_errors, f"Blueprint global errors: {global_errors}"

    # Save and submit
    save_resp = backend_client_user.post("/blueprint/create", json=BlueprintSaveCommand(builder=builder).model_dump())
    assert save_resp.is_success, save_resp.text
    blueprint_id = save_resp.json()["blueprint_id"]

    exec_resp = backend_client_user.post("/run/create", json={"blueprint_id": blueprint_id})
    assert exec_resp.is_success, exec_resp.text
    run_id = RunCreateResponse(**exec_resp.json()).run_id

    ensure_completed_v2(backend_client_user, run_id, sleep=1, attempts=120)

    # Verify the artifact was downloaded during the run
    models_after = backend_client_user.get("/artifacts/list_models").raise_for_status().json()
    downloaded = next(
        (
            m
            for m in models_after
            if m["composite_id"]["artifact_store_id"] == fake_artifact_store_id
            and m["composite_id"]["artifact_local_id"] == test_blueprint_artifact_id
        ),
        None,
    )
    assert downloaded is not None and downloaded["is_available"] == True, "Small checkpoint should be available after run"

    output = pathlib.Path(f"{tmpdir}/filesize_{run_id}.txt")
    assert output.read_text() == "64", f"Expected file size 64, got: {output.read_text()}"

    # Verify compilation detail is accessible and has the expected number of tasks
    detail_resp = backend_client_user.get("/run/getCompilationDetail", params={"run_id": run_id})
    assert detail_resp.is_success, detail_resp.text
    detail = CompilationDetailResponse.model_validate(detail_resp.json())
    assert len(detail.tasks) == 2, f"Expected 2 tasks, got {len(detail.tasks)}: {detail.tasks}"

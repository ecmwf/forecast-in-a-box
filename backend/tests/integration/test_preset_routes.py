# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Integration tests for the preset routes (/api/v1/presets/*).

Covers:
- Full CRUD lifecycle: create → get → list → update → delete.
- /instantiate for each difficulty tier (beginner, intermediate, advanced).
- /categories returns correct distinct values.
- Auth: non-admin cannot create/update/delete.
- Pagination on /list.
- Happy paths and error cases for every endpoint.

Test ordering note
------------------
``backend_client_with_auth`` registers ``authenticated_user@somewhere.org``
as the *first* user in the session-scoped server, which makes that account a
superuser (admin).  All admin-requiring tests use that fixture directly.

For non-admin tests a second account (``preset_nonadmin@somewhere.org``) is
registered once per session via the ``non_admin_client`` fixture.
"""

from typing import Any, Generator

import httpx
import pytest

from .conftest import testPluginId
from .utils import extract_auth_token_from_response, prepare_cookie_with_auth_token

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

# A minimal valid BlueprintBuilder payload (no blocks, no glyphs).
_EMPTY_BUILDER: dict[str, Any] = {
    "blocks": {},
    "environment": None,
    "local_glyphs": {},
}


def _make_create_body(
    *,
    name: str = "Test Preset",
    description: str = "A test preset",
    difficulty: str = "beginner",
    tags: list[str] | None = None,
    is_published: bool = True,
    icon: str = "Cloud",
    parameters: list[dict] | None = None,
) -> dict[str, Any]:
    """Return a minimal valid PresetCreateRequest payload."""
    return {
        "name": name,
        "description": description,
        "long_description": None,
        "difficulty": difficulty,
        "tags": tags or [],
        "icon": icon,
        "builder_template": _EMPTY_BUILDER,
        "parameters": parameters or [],
        "is_published": is_published,
    }


# ---------------------------------------------------------------------------
# Session-scoped non-admin client fixture
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def non_admin_client(backend_client: httpx.Client) -> Generator[httpx.Client, None, None]:
    """Return a *copy* of the base client authenticated as a non-admin user.

    We create a fresh httpx.Client sharing the same base_url so that cookie
    state is independent from the admin client used by other tests.
    """
    # Register a second user (non-admin because the first slot is already taken).
    headers = {"Content-Type": "application/json"}
    reg_resp = backend_client.post(
        "/auth/register",
        headers=headers,
        json={"email": "preset_nonadmin@somewhere.org", "password": "something"},
    )
    # 400 means already registered (session-scoped server), which is fine.
    assert reg_resp.is_success or reg_resp.status_code == 400, reg_resp.text

    login_resp = backend_client.post(
        "/auth/jwt/login",
        data={"username": "preset_nonadmin@somewhere.org", "password": "something"},
    )
    assert login_resp.is_success, login_resp.text
    token = extract_auth_token_from_response(login_resp)
    assert token is not None, "Non-admin token should not be None"

    # Build a separate client so we don't clobber the shared admin cookie.
    client = httpx.Client(base_url=backend_client.base_url, follow_redirects=True)
    client.cookies.set(**prepare_cookie_with_auth_token(token))
    yield client
    client.close()


# Category filter / endpoint removed — presets are tagged, not categorised.


# ===========================================================================
# /list — paginated, any authenticated user
# ===========================================================================


def test_list_returns_paginated_response_shape(backend_client_with_auth: httpx.Client) -> None:
    """GET /presets/list returns the expected pagination envelope."""
    resp = backend_client_with_auth.get("/presets/list")
    assert resp.is_success, resp.text
    data = resp.json()
    assert "presets" in data
    assert "total" in data
    assert "page" in data
    assert "page_size" in data
    assert isinstance(data["presets"], list)
    assert isinstance(data["total"], int)


def test_list_pagination_page_and_page_size(backend_client_with_auth: httpx.Client) -> None:
    """Pagination parameters page and page_size are respected."""
    # Create three published presets so we have a known set to paginate over.
    created: list[tuple[str, int]] = []
    for i in range(3):
        resp = backend_client_with_auth.post(
            "/presets/create",
            json=_make_create_body(name=f"Pagination preset {i}", is_published=True),
        )
        assert resp.is_success, resp.text
        d = resp.json()
        created.append((d["preset_id"], d["version"]))

    # Page 1 with page_size=2 should return at most 2 items.
    resp = backend_client_with_auth.get("/presets/list", params={"page": 1, "page_size": 2})
    assert resp.is_success, resp.text
    data = resp.json()
    assert data["page"] == 1
    assert data["page_size"] == 2
    assert len(data["presets"]) <= 2

    # Page 2 with page_size=2.
    resp2 = backend_client_with_auth.get("/presets/list", params={"page": 2, "page_size": 2})
    assert resp2.is_success, resp2.text
    data2 = resp2.json()
    assert data2["page"] == 2

    # The two pages must not overlap.
    ids_p1 = {p["preset_id"] for p in data["presets"]}
    ids_p2 = {p["preset_id"] for p in data2["presets"]}
    assert ids_p1.isdisjoint(ids_p2), "Pages must not overlap"

    # Clean up.
    for pid, ver in created:
        backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": ver})


def test_list_invalid_pagination_returns_422(backend_client_with_auth: httpx.Client) -> None:
    """page < 1 or page_size < 1 must return 422."""
    resp = backend_client_with_auth.get("/presets/list", params={"page": 0})
    assert resp.status_code == 422

    resp = backend_client_with_auth.get("/presets/list", params={"page_size": 0})
    assert resp.status_code == 422


def test_list_filter_by_difficulty(backend_client_with_auth: httpx.Client) -> None:
    """The difficulty filter returns only presets at that difficulty."""
    resp = backend_client_with_auth.post(
        "/presets/create",
        json=_make_create_body(name="Difficulty filter preset", difficulty="advanced", is_published=True),
    )
    assert resp.is_success, resp.text
    d = resp.json()
    pid, ver = d["preset_id"], d["version"]

    resp = backend_client_with_auth.get("/presets/list", params={"difficulty": "advanced"})
    assert resp.is_success, resp.text
    data = resp.json()
    assert data["total"] >= 1
    assert all(p["difficulty"] == "advanced" for p in data["presets"])

    # Clean up.
    backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": ver})


def test_list_filter_by_search(backend_client_with_auth: httpx.Client) -> None:
    """The search filter matches against name, description, and tags."""
    unique_token = "xyzuniquesearchtoken987"
    resp = backend_client_with_auth.post(
        "/presets/create",
        json=_make_create_body(
            name=f"Search test {unique_token}",
            description="A preset for search testing",
            tags=["searchable"],
            is_published=True,
        ),
    )
    assert resp.is_success, resp.text
    d = resp.json()
    pid, ver = d["preset_id"], d["version"]

    # Search by name token.
    resp = backend_client_with_auth.get("/presets/list", params={"search": unique_token})
    assert resp.is_success, resp.text
    data = resp.json()
    assert data["total"] >= 1
    assert any(p["preset_id"] == pid for p in data["presets"])

    # Clean up.
    backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": ver})


def test_list_includes_builder_template(backend_client_with_auth: httpx.Client) -> None:
    """List items expose ``builder_template`` so the gallery can render a mini preview without a per-card /get round-trip."""
    resp = backend_client_with_auth.post(
        "/presets/create",
        json=_make_create_body(name="Template list test", is_published=True),
    )
    assert resp.is_success, resp.text
    d = resp.json()
    pid, ver = d["preset_id"], d["version"]

    resp = backend_client_with_auth.get("/presets/list")
    assert resp.is_success, resp.text
    items = resp.json()["presets"]
    assert items, "Should have at least one preset"
    for item in items:
        assert "builder_template" in item, "List items expose builder_template for previews"
        # Parameters are still elided from /list — use /get for those.
        assert "parameters" not in item

    # Clean up.
    backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": ver})


# ===========================================================================
# Full CRUD lifecycle
# ===========================================================================


def test_crud_lifecycle(backend_client_with_auth: httpx.Client) -> None:
    """Full create → get → list → update → delete lifecycle."""

    # --- CREATE ---
    create_body = _make_create_body(
        name="CRUD Lifecycle Preset",
        description="Initial description",
        difficulty="intermediate",
        tags=["crud", "lifecycle"],
        is_published=True,
    )
    resp = backend_client_with_auth.post("/presets/create", json=create_body)
    assert resp.is_success, resp.text
    created = resp.json()
    assert "preset_id" in created
    assert created["version"] == 1
    preset_id = created["preset_id"]

    # --- GET (latest) ---
    resp = backend_client_with_auth.get("/presets/get", params={"preset_id": preset_id})
    assert resp.is_success, resp.text
    got = resp.json()
    assert got["preset_id"] == preset_id
    assert got["version"] == 1
    assert got["name"] == "CRUD Lifecycle Preset"
    assert got["description"] == "Initial description"
    assert got["difficulty"] == "intermediate"
    assert got["tags"] == ["crud", "lifecycle"]
    assert got["is_published"] is True
    # Full detail must include builder_template.
    assert "builder_template" in got
    assert "parameters" in got

    # --- LIST (verify it appears) ---
    resp = backend_client_with_auth.get("/presets/list", params={"search": "CRUD Lifecycle"})
    assert resp.is_success, resp.text
    list_data = resp.json()
    assert list_data["total"] >= 1
    ids = [p["preset_id"] for p in list_data["presets"]]
    assert preset_id in ids

    # --- UPDATE ---
    update_body = {
        "preset_id": preset_id,
        "version": 1,
        "name": "CRUD Lifecycle Preset v2",
        "description": "Updated description",
        "long_description": "A longer description added in v2",
        "difficulty": "advanced",
        "tags": ["crud", "lifecycle", "updated"],
        "icon": "Cloud",
        "builder_template": _EMPTY_BUILDER,
        "parameters": [],
        "is_published": True,
    }
    resp = backend_client_with_auth.post("/presets/update", json=update_body)
    assert resp.is_success, resp.text
    updated = resp.json()
    assert updated["preset_id"] == preset_id
    assert updated["version"] == 2

    # GET latest should now return version 2.
    resp = backend_client_with_auth.get("/presets/get", params={"preset_id": preset_id})
    assert resp.is_success, resp.text
    got_v2 = resp.json()
    assert got_v2["version"] == 2
    assert got_v2["name"] == "CRUD Lifecycle Preset v2"
    assert got_v2["description"] == "Updated description"
    assert got_v2["difficulty"] == "advanced"

    # GET specific version 1 still works.
    resp = backend_client_with_auth.get("/presets/get", params={"preset_id": preset_id, "version": 1})
    assert resp.is_success, resp.text
    got_v1 = resp.json()
    assert got_v1["version"] == 1
    assert got_v1["name"] == "CRUD Lifecycle Preset"

    # --- DELETE ---
    resp = backend_client_with_auth.post("/presets/delete", json={"preset_id": preset_id, "version": 2})
    assert resp.is_success, resp.text

    # After deletion, GET must return 404.
    resp = backend_client_with_auth.get("/presets/get", params={"preset_id": preset_id})
    assert resp.status_code == 404

    # After deletion, it must not appear in the list.
    resp = backend_client_with_auth.get("/presets/list", params={"search": "CRUD Lifecycle"})
    assert resp.is_success, resp.text
    ids_after = [p["preset_id"] for p in resp.json()["presets"]]
    assert preset_id not in ids_after


# ===========================================================================
# /create — admin-only
# ===========================================================================


def test_create_returns_preset_id_and_version_1(backend_client_with_auth: httpx.Client) -> None:
    """POST /presets/create returns preset_id and version=1."""
    resp = backend_client_with_auth.post(
        "/presets/create",
        json=_make_create_body(name="Create version test"),
    )
    assert resp.is_success, resp.text
    data = resp.json()
    assert "preset_id" in data
    assert data["version"] == 1
    # Clean up.
    backend_client_with_auth.post("/presets/delete", json={"preset_id": data["preset_id"], "version": 1})


def test_create_missing_required_field_returns_422(backend_client_with_auth: httpx.Client) -> None:
    """POST /presets/create without required fields returns 422."""
    resp = backend_client_with_auth.post("/presets/create", json={})
    assert resp.status_code == 422


def test_create_invalid_difficulty_returns_422(backend_client_with_auth: httpx.Client) -> None:
    """POST /presets/create with an invalid difficulty value returns 422."""
    body = _make_create_body(name="Bad difficulty")
    body["difficulty"] = "expert"  # not a valid Literal
    resp = backend_client_with_auth.post("/presets/create", json=body)
    assert resp.status_code == 422


def test_create_non_admin_returns_403(non_admin_client: httpx.Client) -> None:
    """Non-admin users must receive 403 when attempting to create a preset."""
    resp = non_admin_client.post(
        "/presets/create",
        json=_make_create_body(name="Non-admin create attempt"),
    )
    assert resp.status_code == 403


# ===========================================================================
# /get — any authenticated user
# ===========================================================================


def test_get_nonexistent_preset_returns_404(backend_client_with_auth: httpx.Client) -> None:
    """GET /presets/get with an unknown preset_id returns 404."""
    resp = backend_client_with_auth.get("/presets/get", params={"preset_id": "does-not-exist"})
    assert resp.status_code == 404


def test_get_missing_preset_id_returns_422(backend_client_with_auth: httpx.Client) -> None:
    """GET /presets/get without preset_id returns 422."""
    resp = backend_client_with_auth.get("/presets/get")
    assert resp.status_code == 422


def test_get_returns_full_detail_including_builder_template(backend_client_with_auth: httpx.Client) -> None:
    """GET /presets/get returns builder_template and parameters in the response."""
    params = [
        {
            "glyph_key": "date",
            "label": "Date",
            "description": "Forecast date",
            "value_type": "string",
            "default_value": "20240101",
        }
    ]
    resp = backend_client_with_auth.post(
        "/presets/create",
        json=_make_create_body(name="Full detail test", parameters=params),
    )
    assert resp.is_success, resp.text
    d = resp.json()
    pid, ver = d["preset_id"], d["version"]

    resp = backend_client_with_auth.get("/presets/get", params={"preset_id": pid})
    assert resp.is_success, resp.text
    got = resp.json()
    assert "builder_template" in got
    assert "parameters" in got
    assert len(got["parameters"]) == 1
    assert got["parameters"][0]["glyph_key"] == "date"

    # Clean up.
    backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": ver})


# ===========================================================================
# /update — admin-only
# ===========================================================================


def test_update_non_admin_returns_403(non_admin_client: httpx.Client, backend_client_with_auth: httpx.Client) -> None:
    """Non-admin users must receive 403 when attempting to update a preset."""
    # Admin creates the preset.
    resp = backend_client_with_auth.post(
        "/presets/create",
        json=_make_create_body(name="Update auth test"),
    )
    assert resp.is_success, resp.text
    d = resp.json()
    pid, ver = d["preset_id"], d["version"]

    update_body = {
        "preset_id": pid,
        "version": ver,
        "name": "Should be rejected",
        "description": "desc",
        "difficulty": "beginner",
        "tags": [],
        "icon": "Cloud",
        "builder_template": _EMPTY_BUILDER,
        "parameters": [],
        "is_published": False,
    }
    resp = non_admin_client.post("/presets/update", json=update_body)
    assert resp.status_code == 403

    # Clean up.
    backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": ver})


def test_update_nonexistent_preset_returns_404(backend_client_with_auth: httpx.Client) -> None:
    """POST /presets/update for a non-existent preset_id returns 404."""
    update_body = {
        "preset_id": "no-such-preset-id",
        "version": 1,
        "name": "Ghost update",
        "description": "desc",
        "difficulty": "beginner",
        "tags": [],
        "icon": "Cloud",
        "builder_template": _EMPTY_BUILDER,
        "parameters": [],
        "is_published": False,
    }
    resp = backend_client_with_auth.post("/presets/update", json=update_body)
    assert resp.status_code == 404


def test_update_version_conflict_returns_409(backend_client_with_auth: httpx.Client) -> None:
    """POST /presets/update with a stale version returns 409."""
    resp = backend_client_with_auth.post(
        "/presets/create",
        json=_make_create_body(name="Version conflict test"),
    )
    assert resp.is_success, resp.text
    d = resp.json()
    pid = d["preset_id"]

    # First update succeeds (version 1 → 2).
    update_body = {
        "preset_id": pid,
        "version": 1,
        "name": "Version conflict test v2",
        "description": "desc",
        "difficulty": "beginner",
        "tags": [],
        "icon": "Cloud",
        "builder_template": _EMPTY_BUILDER,
        "parameters": [],
        "is_published": False,
    }
    resp = backend_client_with_auth.post("/presets/update", json=update_body)
    assert resp.is_success, resp.text
    assert resp.json()["version"] == 2

    # Second update with stale version=1 must return 409.
    resp = backend_client_with_auth.post("/presets/update", json=update_body)
    assert resp.status_code == 409

    # Clean up.
    backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": 2})


# ===========================================================================
# /delete — admin-only
# ===========================================================================


def test_delete_non_admin_returns_403(non_admin_client: httpx.Client, backend_client_with_auth: httpx.Client) -> None:
    """Non-admin users must receive 403 when attempting to delete a preset."""
    resp = backend_client_with_auth.post(
        "/presets/create",
        json=_make_create_body(name="Delete auth test"),
    )
    assert resp.is_success, resp.text
    d = resp.json()
    pid, ver = d["preset_id"], d["version"]

    resp = non_admin_client.post("/presets/delete", json={"preset_id": pid, "version": ver})
    assert resp.status_code == 403

    # Clean up (admin deletes).
    backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": ver})


def test_delete_nonexistent_preset_returns_404(backend_client_with_auth: httpx.Client) -> None:
    """POST /presets/delete for a non-existent preset_id returns 404."""
    resp = backend_client_with_auth.post("/presets/delete", json={"preset_id": "ghost-id", "version": 1})
    assert resp.status_code == 404


def test_delete_version_conflict_returns_409(backend_client_with_auth: httpx.Client) -> None:
    """POST /presets/delete with a stale version returns 409."""
    resp = backend_client_with_auth.post(
        "/presets/create",
        json=_make_create_body(name="Delete conflict test"),
    )
    assert resp.is_success, resp.text
    d = resp.json()
    pid = d["preset_id"]

    # Advance to version 2.
    update_body = {
        "preset_id": pid,
        "version": 1,
        "name": "Delete conflict test v2",
        "description": "desc",
        "difficulty": "beginner",
        "tags": [],
        "icon": "Cloud",
        "builder_template": _EMPTY_BUILDER,
        "parameters": [],
        "is_published": False,
    }
    resp = backend_client_with_auth.post("/presets/update", json=update_body)
    assert resp.is_success, resp.text

    # Attempt to delete with stale version=1 must return 409.
    resp = backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": 1})
    assert resp.status_code == 409

    # Clean up.
    backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": 2})


# ===========================================================================
# /instantiate — any authenticated user
# ===========================================================================


def _create_preset_for_instantiate(
    client: httpx.Client,
    *,
    difficulty: str,
    parameters: list[dict] | None = None,
) -> tuple[str, int]:
    """Helper: create a preset and return (preset_id, version)."""
    resp = client.post(
        "/presets/create",
        json=_make_create_body(
            name=f"Instantiate test ({difficulty})",
            difficulty=difficulty,
            is_published=True,
            parameters=parameters,
        ),
    )
    assert resp.is_success, resp.text
    d = resp.json()
    return d["preset_id"], d["version"]


def test_instantiate_advanced_with_default_auto_run_creates_blueprint_and_run(
    backend_client_with_auth: httpx.Client,
) -> None:
    """Advanced presets with default auto_run=True: /instantiate returns blueprint_id and run_id.

    The service no longer branches on difficulty — auto_run controls the behaviour.
    """
    pid, ver = _create_preset_for_instantiate(backend_client_with_auth, difficulty="advanced")

    resp = backend_client_with_auth.post(
        "/presets/instantiate",
        json={"preset_id": pid, "parameter_values": {}},
        # auto_run defaults to True on the backend
    )
    assert resp.is_success, resp.text
    data = resp.json()
    assert "builder" in data
    assert data["blueprint_id"] is not None
    assert data["blueprint_version"] is not None
    assert data["run_id"] is not None
    assert data["attempt_count"] is not None

    # Clean up.
    backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": ver})


def test_instantiate_with_auto_run_false_returns_builder_only(
    backend_client_with_auth: httpx.Client,
) -> None:
    """auto_run=False: /instantiate returns the materialised builder only.

    No persistence happens server-side — the caller is expected to open
    the builder in the editor and save explicitly. blueprint_id,
    blueprint_version, run_id, and attempt_count are all None.
    """
    pid, ver = _create_preset_for_instantiate(backend_client_with_auth, difficulty="advanced")

    resp = backend_client_with_auth.post(
        "/presets/instantiate",
        json={"preset_id": pid, "parameter_values": {}, "auto_run": False},
    )
    assert resp.is_success, resp.text
    data = resp.json()
    assert "builder" in data
    assert data["blueprint_id"] is None, "blueprint_id should be None when auto_run=False"
    assert data["blueprint_version"] is None, "blueprint_version should be None when auto_run=False"
    assert data["run_id"] is None, "run_id should be None when auto_run=False"
    assert data["attempt_count"] is None, "attempt_count should be None when auto_run=False"

    # Clean up.
    backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": ver})


def test_instantiate_beginner_creates_blueprint_and_run(backend_client_with_auth: httpx.Client) -> None:
    """Beginner presets: /instantiate returns blueprint_id, blueprint_version, run_id, and attempt_count."""
    pid, ver = _create_preset_for_instantiate(backend_client_with_auth, difficulty="beginner")

    resp = backend_client_with_auth.post(
        "/presets/instantiate",
        json={"preset_id": pid, "parameter_values": {}},
    )
    assert resp.is_success, resp.text
    data = resp.json()
    assert "builder" in data
    assert data["blueprint_id"] is not None
    assert data["blueprint_version"] is not None
    assert data["run_id"] is not None
    assert data["attempt_count"] is not None
    assert isinstance(data["blueprint_version"], int)
    assert isinstance(data["attempt_count"], int)

    # Clean up.
    backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": ver})


def test_instantiate_intermediate_creates_blueprint_and_run(backend_client_with_auth: httpx.Client) -> None:
    """Intermediate presets: /instantiate returns blueprint_id, blueprint_version, run_id, and attempt_count."""
    pid, ver = _create_preset_for_instantiate(backend_client_with_auth, difficulty="intermediate")

    resp = backend_client_with_auth.post(
        "/presets/instantiate",
        json={"preset_id": pid, "parameter_values": {}},
    )
    assert resp.is_success, resp.text
    data = resp.json()
    assert data["blueprint_id"] is not None
    assert data["run_id"] is not None

    # Clean up.
    backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": ver})


def test_instantiate_injects_parameter_values(backend_client_with_auth: httpx.Client) -> None:
    """Parameter values supplied by the caller are injected into the builder's local_glyphs."""
    params = [
        {
            "glyph_key": "mydate",
            "label": "Date",
            "description": "Forecast date",
            "value_type": "string",
            "default_value": "20240101",
        }
    ]
    pid, ver = _create_preset_for_instantiate(
        backend_client_with_auth,
        difficulty="advanced",
        parameters=params,
    )

    resp = backend_client_with_auth.post(
        "/presets/instantiate",
        json={"preset_id": pid, "parameter_values": {"mydate": "20250601"}},
    )
    assert resp.is_success, resp.text
    data = resp.json()
    assert data["builder"]["local_glyphs"]["mydate"] == "20250601"

    # Clean up.
    backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": ver})


def test_instantiate_uses_default_when_parameter_omitted(backend_client_with_auth: httpx.Client) -> None:
    """When a parameter key is absent from parameter_values, its default_value is used."""
    params = [
        {
            "glyph_key": "steps",
            "label": "Steps",
            "description": "Forecast steps",
            "value_type": "integer",
            "default_value": "42",
        }
    ]
    pid, ver = _create_preset_for_instantiate(
        backend_client_with_auth,
        difficulty="advanced",
        parameters=params,
    )

    resp = backend_client_with_auth.post(
        "/presets/instantiate",
        json={"preset_id": pid, "parameter_values": {}},
    )
    assert resp.is_success, resp.text
    data = resp.json()
    assert data["builder"]["local_glyphs"]["steps"] == "42"

    # Clean up.
    backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": ver})


def test_instantiate_nonexistent_preset_returns_404(backend_client_with_auth: httpx.Client) -> None:
    """POST /presets/instantiate with an unknown preset_id returns 404."""
    resp = backend_client_with_auth.post(
        "/presets/instantiate",
        json={"preset_id": "does-not-exist", "parameter_values": {}},
    )
    assert resp.status_code == 404


def test_instantiate_missing_preset_id_returns_422(backend_client_with_auth: httpx.Client) -> None:
    """POST /presets/instantiate without preset_id returns 422."""
    resp = backend_client_with_auth.post("/presets/instantiate", json={})
    assert resp.status_code == 422


def test_instantiate_non_admin_can_call(non_admin_client: httpx.Client, backend_client_with_auth: httpx.Client) -> None:
    """Any authenticated user (not just admin) may call /instantiate."""
    pid, ver = _create_preset_for_instantiate(backend_client_with_auth, difficulty="advanced")

    resp = non_admin_client.post(
        "/presets/instantiate",
        json={"preset_id": pid, "parameter_values": {}},
    )
    assert resp.is_success, resp.text

    # Clean up (admin deletes).
    backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": ver})


# ===========================================================================
# Additional edge-case / regression tests
# ===========================================================================


def test_get_specific_version_after_update(backend_client_with_auth: httpx.Client) -> None:
    """After updating, both version 1 and version 2 are retrievable by explicit version."""
    resp = backend_client_with_auth.post(
        "/presets/create",
        json=_make_create_body(name="Version history test"),
    )
    assert resp.is_success, resp.text
    d = resp.json()
    pid = d["preset_id"]

    update_body = {
        "preset_id": pid,
        "version": 1,
        "name": "Version history test v2",
        "description": "Updated",
        "difficulty": "beginner",
        "tags": [],
        "icon": "Cloud",
        "builder_template": _EMPTY_BUILDER,
        "parameters": [],
        "is_published": False,
    }
    resp = backend_client_with_auth.post("/presets/update", json=update_body)
    assert resp.is_success, resp.text

    # Version 1 is still accessible.
    resp = backend_client_with_auth.get("/presets/get", params={"preset_id": pid, "version": 1})
    assert resp.is_success, resp.text
    assert resp.json()["name"] == "Version history test"

    # Version 2 is accessible.
    resp = backend_client_with_auth.get("/presets/get", params={"preset_id": pid, "version": 2})
    assert resp.is_success, resp.text
    assert resp.json()["name"] == "Version history test v2"

    # Latest (no version param) returns version 2.
    resp = backend_client_with_auth.get("/presets/get", params={"preset_id": pid})
    assert resp.is_success, resp.text
    assert resp.json()["version"] == 2

    # Clean up.
    backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": 2})


def test_list_total_reflects_published_count(backend_client_with_auth: httpx.Client) -> None:
    """The total field in /list reflects only published presets."""
    unique_search = "total-count-test-unique-xyz"

    # Record baseline.
    resp = backend_client_with_auth.get("/presets/list", params={"search": unique_search})
    assert resp.is_success, resp.text
    baseline_total = resp.json()["total"]

    # Add one published and one unpublished preset.
    resp_pub = backend_client_with_auth.post(
        "/presets/create",
        json=_make_create_body(name=f"Published count test {unique_search}", is_published=True),
    )
    assert resp_pub.is_success, resp_pub.text
    d_pub = resp_pub.json()

    resp_unp = backend_client_with_auth.post(
        "/presets/create",
        json=_make_create_body(name=f"Unpublished count test {unique_search}", is_published=False),
    )
    assert resp_unp.is_success, resp_unp.text
    d_unp = resp_unp.json()

    resp = backend_client_with_auth.get("/presets/list", params={"search": unique_search})
    assert resp.is_success, resp.text
    new_total = resp.json()["total"]
    # Only the published one should have incremented the count.
    assert new_total == baseline_total + 1

    # Clean up.
    backend_client_with_auth.post("/presets/delete", json={"preset_id": d_pub["preset_id"], "version": d_pub["version"]})
    backend_client_with_auth.post("/presets/delete", json={"preset_id": d_unp["preset_id"], "version": d_unp["version"]})


def test_instantiate_all_three_difficulty_tiers_with_auto_run_true(
    backend_client_with_auth: httpx.Client,
) -> None:
    """Smoke-test all three difficulty tiers with auto_run=True (default).

    All tiers should return blueprint_id and run_id when auto_run=True.
    """
    results: dict[str, Any] = {}
    created: list[tuple[str, int]] = []

    for difficulty in ("beginner", "intermediate", "advanced"):
        pid, ver = _create_preset_for_instantiate(backend_client_with_auth, difficulty=difficulty)
        created.append((pid, ver))

        resp = backend_client_with_auth.post(
            "/presets/instantiate",
            json={"preset_id": pid, "parameter_values": {}, "auto_run": True},
        )
        assert resp.is_success, f"instantiate failed for {difficulty}: {resp.text}"
        results[difficulty] = resp.json()

    # All tiers: blueprint and run are populated when auto_run=True.
    for tier in ("beginner", "intermediate", "advanced"):
        assert results[tier]["blueprint_id"] is not None, f"{tier} should have blueprint_id"
        assert results[tier]["run_id"] is not None, f"{tier} should have run_id"

    # Clean up.
    for pid, ver in created:
        backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": ver})


def test_instantiate_all_three_difficulty_tiers_with_auto_run_false(
    backend_client_with_auth: httpx.Client,
) -> None:
    """Smoke-test all three difficulty tiers with auto_run=False.

    No persistence happens server-side for any tier: the response only
    contains the materialised builder.
    """
    results: dict[str, Any] = {}
    created: list[tuple[str, int]] = []

    for difficulty in ("beginner", "intermediate", "advanced"):
        pid, ver = _create_preset_for_instantiate(backend_client_with_auth, difficulty=difficulty)
        created.append((pid, ver))

        resp = backend_client_with_auth.post(
            "/presets/instantiate",
            json={"preset_id": pid, "parameter_values": {}, "auto_run": False},
        )
        assert resp.is_success, f"instantiate failed for {difficulty}: {resp.text}"
        results[difficulty] = resp.json()

    # All tiers: nothing persisted, builder returned only.
    for tier in ("beginner", "intermediate", "advanced"):
        assert results[tier]["builder"] is not None, f"{tier} should have a materialised builder"
        assert results[tier]["blueprint_id"] is None, f"{tier} should have no blueprint_id"
        assert results[tier]["run_id"] is None, f"{tier} should have no run_id"

    # Clean up.
    for pid, ver in created:
        backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": ver})


# ===========================================================================
# /publish — admin-only, in-place publish toggle (no version increment)
# ===========================================================================


def test_publish_toggle_does_not_increment_version(backend_client_with_auth: httpx.Client) -> None:
    """POST /presets/publish toggles is_published without creating a new version."""
    resp = backend_client_with_auth.post(
        "/presets/create",
        json=_make_create_body(name="Publish toggle test", is_published=True),
    )
    assert resp.is_success, resp.text
    d = resp.json()
    pid, ver = d["preset_id"], d["version"]
    assert ver == 1

    # Unpublish — version must remain 1.
    resp = backend_client_with_auth.post(
        "/presets/publish",
        json={"preset_id": pid, "version": ver, "is_published": False},
    )
    assert resp.is_success, resp.text

    resp = backend_client_with_auth.get("/presets/get", params={"preset_id": pid})
    assert resp.is_success, resp.text
    got = resp.json()
    assert got["version"] == 1, "Version must not be incremented by publish toggle"
    assert got["is_published"] is False

    # Re-publish — version must still be 1.
    resp = backend_client_with_auth.post(
        "/presets/publish",
        json={"preset_id": pid, "version": 1, "is_published": True},
    )
    assert resp.is_success, resp.text

    resp = backend_client_with_auth.get("/presets/get", params={"preset_id": pid})
    assert resp.is_success, resp.text
    got = resp.json()
    assert got["version"] == 1
    assert got["is_published"] is True

    # Clean up.
    backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": 1})


def test_publish_non_admin_returns_403(non_admin_client: httpx.Client, backend_client_with_auth: httpx.Client) -> None:
    """Non-admin users must receive 403 when attempting to toggle publish status."""
    resp = backend_client_with_auth.post(
        "/presets/create",
        json=_make_create_body(name="Publish auth test", is_published=True),
    )
    assert resp.is_success, resp.text
    d = resp.json()
    pid, ver = d["preset_id"], d["version"]

    resp = non_admin_client.post(
        "/presets/publish",
        json={"preset_id": pid, "version": ver, "is_published": False},
    )
    assert resp.status_code == 403

    # Clean up.
    backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": ver})


def test_publish_nonexistent_preset_returns_404(backend_client_with_auth: httpx.Client) -> None:
    """POST /presets/publish for a non-existent preset_id returns 404."""
    resp = backend_client_with_auth.post(
        "/presets/publish",
        json={"preset_id": "ghost-preset-id", "version": 1, "is_published": False},
    )
    assert resp.status_code == 404


def test_publish_version_conflict_returns_409(backend_client_with_auth: httpx.Client) -> None:
    """POST /presets/publish with a stale version returns 409."""
    resp = backend_client_with_auth.post(
        "/presets/create",
        json=_make_create_body(name="Publish conflict test", is_published=True),
    )
    assert resp.is_success, resp.text
    d = resp.json()
    pid, ver = d["preset_id"], d["version"]

    # Attempt to toggle with a stale version.
    resp = backend_client_with_auth.post(
        "/presets/publish",
        json={"preset_id": pid, "version": 999, "is_published": False},
    )
    assert resp.status_code == 409

    # Clean up.
    backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": ver})


def test_publish_toggle_is_independent_of_update(backend_client_with_auth: httpx.Client) -> None:
    """Toggling publish after an update still uses the current version and does not increment it."""
    resp = backend_client_with_auth.post(
        "/presets/create",
        json=_make_create_body(name="Publish after update test", is_published=True),
    )
    assert resp.is_success, resp.text
    d = resp.json()
    pid = d["preset_id"]

    # Advance to version 2 via a content update.
    update_body = {
        "preset_id": pid,
        "version": 1,
        "name": "Publish after update test v2",
        "description": "Updated description",
        "difficulty": "beginner",
        "tags": [],
        "icon": "Cloud",
        "builder_template": _EMPTY_BUILDER,
        "parameters": [],
        "is_published": True,
    }
    resp = backend_client_with_auth.post("/presets/update", json=update_body)
    assert resp.is_success, resp.text
    assert resp.json()["version"] == 2

    # Now toggle publish on version 2 — version must stay at 2.
    resp = backend_client_with_auth.post(
        "/presets/publish",
        json={"preset_id": pid, "version": 2, "is_published": False},
    )
    assert resp.is_success, resp.text

    resp = backend_client_with_auth.get("/presets/get", params={"preset_id": pid})
    assert resp.is_success, resp.text
    got = resp.json()
    assert got["version"] == 2, "Version must not be incremented by publish toggle"
    assert got["is_published"] is False

    # Clean up.
    backend_client_with_auth.post("/presets/delete", json={"preset_id": pid, "version": 2})

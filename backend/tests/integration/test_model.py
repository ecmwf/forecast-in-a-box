from typing import Any

import httpx

from .conftest import fake_artifact_checkpoint_id, fake_artifact_registry_port, fake_artifact_store_id
from .utils import extract_auth_token_from_response, prepare_cookie_with_auth_token, retry_until


def test_download_model(backend_client: httpx.Client) -> None:
    """Downloads bunch of artifacts in parallel, tests they successfully appear"""

    # TODO shame! This test *assumes* that test_admin_flows has already been executed,
    # which is guaranteed only due to alphabetical serendipity. Possibly move that creation
    # to conftest -- but then conftest itself should *not* represent a test...
    # Or use something like https://pytest-ordering.readthedocs.io/en/develop/
    headers = {"Content-Type": "application/json"}
    data = {"email": "admin@somewhere.org", "password": "something"}
    response = backend_client.post("/auth/register", headers=headers, json=data)
    # NOTE we are ok with 400 here -- that just means the test_admin has succeeded. But we still
    # keep the register call here to make sure this test can run on its own
    # assert response.is_success
    data = {"username": "admin@somewhere.org", "password": "something"}
    response = backend_client.post("/auth/jwt/login", data=data)
    assert response.is_success
    token_admin = extract_auth_token_from_response(response)
    assert token_admin is not None, "Token should not be None"
    backend_client.cookies.set(**prepare_cookie_with_auth_token(token_admin))

    # Verify fake artifact registry is up
    try:
        client = httpx.Client(transport=httpx.HTTPTransport(retries=3))
        catalog_response = client.get(f"http://localhost:{fake_artifact_registry_port}/artifacts.json")
        assert catalog_response.is_success, "Failed to start Fake Artifact Registry properly"
    except httpx.ConnectError:
        assert False, "Failed to start Fake Artifact Registry properly"

    # List all available models
    response = backend_client.get("/artifacts/list_models").raise_for_status()
    models = response.json()
    assert len(models) >= 4, f"Expected at least 4 models, got {len(models)}"

    # Verify none are downloaded yet
    for model in models:
        if model["composite_id"]["artifact_store_id"] == fake_artifact_store_id:
            assert model["is_available"] == False, f"Model {model['composite_id']['ml_model_checkpoint_id']} should not be downloaded yet"

    # Submit download for all 4 models in parallel
    expected_checkpoints = {f"{fake_artifact_checkpoint_id}{e}" for e in range(4)}
    for checkpoint_id in expected_checkpoints:
        composite_id = {
            "artifact_store_id": fake_artifact_store_id,
            "ml_model_checkpoint_id": checkpoint_id,
        }
        response = backend_client.post("/artifacts/download_model", json=composite_id).raise_for_status()
        result = response.json()
        assert result["status"] in ["download submitted", "download in progress"], f"Unexpected status: {result}"

    # Wait until all 4 are available
    def do_action() -> Any:
        return backend_client.get("/artifacts/list_models").raise_for_status().json()

    def verify_ok(models: Any) -> bool | None:
        available = {
            m["composite_id"]["ml_model_checkpoint_id"]
            for m in models
            if m["composite_id"]["artifact_store_id"] == fake_artifact_store_id and m["is_available"]
        }
        return True if expected_checkpoints.issubset(available) else None

    retry_until(do_action, verify_ok, attempts=128, sleep=0.2, error_msg="Failed to download all artifacts")

    # Test model details endpoint for checkpoint0
    main_composite_id = {
        "artifact_store_id": fake_artifact_store_id,
        "ml_model_checkpoint_id": f"{fake_artifact_checkpoint_id}0",
    }
    response = backend_client.post("/artifacts/model_details", json=main_composite_id).raise_for_status()
    details = response.json()
    assert details["composite_id"]["artifact_store_id"] == fake_artifact_store_id
    assert details["composite_id"]["ml_model_checkpoint_id"] == f"{fake_artifact_checkpoint_id}0"
    assert details["display_name"] == "Test Model Checkpoint 0"
    assert details["is_available"] == True

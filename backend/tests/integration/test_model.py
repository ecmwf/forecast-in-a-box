import time

import httpx

from forecastbox.models.metadata import ControlMetadata

from .conftest import fake_artifact_checkpoint_id, fake_artifact_registry_port, fake_artifact_store_id
from .utils import extract_auth_token_from_response, prepare_cookie_with_auth_token


def test_download_model(backend_client):
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

    # Find our test model (test_checkpoint0 is the main one)
    test_model = None
    for model in models:
        if (
            model["composite_id"]["artifact_store_id"] == fake_artifact_store_id
            and model["composite_id"]["ml_model_checkpoint_id"] == f"{fake_artifact_checkpoint_id}0"
        ):
            test_model = model
            break

    assert test_model is not None, "Test model not found in list"
    assert test_model["is_available"] == False, "Model should not be downloaded yet"

    # Download models in parallel (test_checkpoint1, test_checkpoint2, test_checkpoint3)
    parallelism = 3
    composite_ids = []
    for e in range(1, parallelism + 1):
        composite_id = {
            "artifact_store_id": fake_artifact_store_id,
            "ml_model_checkpoint_id": f"{fake_artifact_checkpoint_id}{e}",
        }
        response = backend_client.post("/artifacts/download_model", json=composite_id).raise_for_status()
        result = response.json()
        assert result["status"] in ["download submitted", "download in progress"], f"Unexpected status: {result}"
        composite_ids.append(composite_id)

    # Download the main test model (test_checkpoint0)
    main_composite_id = {
        "artifact_store_id": fake_artifact_store_id,
        "ml_model_checkpoint_id": f"{fake_artifact_checkpoint_id}0",
    }
    response = backend_client.post("/artifacts/download_model", json=main_composite_id).raise_for_status()
    result = response.json()
    assert result["status"] in ["download submitted", "download in progress"], f"Unexpected status: {result}"

    # Poll for completion
    i = 256  # Increased from 128 to allow more time
    while i > 0:
        response = backend_client.post("/artifacts/download_model", json=main_composite_id).raise_for_status()
        result = response.json()
        if result["status"] == "available" and result["progress"] == 100:
            break
        time.sleep(0.1)  # Increased from 0.05 to reduce polling frequency
        i -= 1

    assert i > 0, "Failed to download artifact"

    # Verify all models are now available
    response = backend_client.get("/artifacts/list_models").raise_for_status()
    models = response.json()

    available_checkpoints = set()
    for model in models:
        if model["composite_id"]["artifact_store_id"] == fake_artifact_store_id and model["is_available"]:
            available_checkpoints.add(model["composite_id"]["ml_model_checkpoint_id"])

    assert f"{fake_artifact_checkpoint_id}0" in available_checkpoints, "Main model (test_checkpoint0) should be available"
    for e in range(1, parallelism + 1):
        assert f"{fake_artifact_checkpoint_id}{e}" in available_checkpoints, f"Model test_checkpoint{e} should be available"

    # Test model details endpoint
    response = backend_client.post("/artifacts/model_details", json=main_composite_id).raise_for_status()
    details = response.json()
    assert details["composite_id"]["artifact_store_id"] == fake_artifact_store_id
    assert details["composite_id"]["ml_model_checkpoint_id"] == f"{fake_artifact_checkpoint_id}0"
    assert details["display_name"] == "Test Model Checkpoint 0"
    assert details["is_available"] == True

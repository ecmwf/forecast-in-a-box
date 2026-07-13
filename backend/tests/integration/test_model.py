from typing import Any

import httpx

from .conftest import fake_artifact_registry_port, fake_artifact_store_id, test_model_artifact_id
from .utils import extract_auth_token_from_response, prepare_cookie_with_auth_token, retry_until


def test_download_model(backend_client_admin: httpx.Client) -> None:
    """Downloads bunch of artifacts in parallel, tests they successfully appear"""

    # Verify fake artifact registry is up
    try:
        with httpx.Client(transport=httpx.HTTPTransport(retries=3)) as client:
            catalog_response = client.get(f"http://localhost:{fake_artifact_registry_port}/artifacts.json")
            assert catalog_response.is_success, "Failed to start Fake Artifact Registry properly"
    except httpx.ConnectError:
        assert False, "Failed to start Fake Artifact Registry properly"

    # List all available models
    response = backend_client_admin.get("/artifacts/list_models").raise_for_status()
    models = response.json()
    assert len(models) >= 4, f"Expected at least 4 models, got {len(models)}"

    # Verify none are downloaded yet (filter to only the original test_checkpoint* models)
    for model in models:
        if model["composite_id"]["artifact_store_id"] == fake_artifact_store_id and model["composite_id"]["artifact_local_id"].startswith(
            test_model_artifact_id
        ):
            assert model["is_available"] == False, f"Model {model['composite_id']['artifact_local_id']} should not be downloaded yet"
            assert model["is_locally_compatible"] == True
            assert model["local_compatibility_detail"] is None
            assert "tags" in model

    # Submit download for all 4 models in parallel
    expected_checkpoints = {f"{test_model_artifact_id}{e}" for e in range(4)}
    for checkpoint_id in expected_checkpoints:
        composite_id = {
            "artifact_store_id": fake_artifact_store_id,
            "artifact_local_id": checkpoint_id,
        }
        response = backend_client_admin.post("/artifacts/download_model", json=composite_id).raise_for_status()
        result = response.json()
        assert result["status"] in ["download submitted", "download in progress"], f"Unexpected status: {result}"

    # Wait until all 4 are available
    def do_action() -> Any:
        return backend_client_admin.get("/artifacts/list_models").raise_for_status().json()

    def verify_ok(models: Any) -> bool | None:
        available = {
            m["composite_id"]["artifact_local_id"]
            for m in models
            if m["composite_id"]["artifact_store_id"] == fake_artifact_store_id and m["is_available"]
        }
        return True if expected_checkpoints.issubset(available) else None

    retry_until(do_action, verify_ok, attempts=128, sleep=0.2, error_msg="Failed to download all artifacts")

    # Test model details endpoint for checkpoint0
    main_composite_id = {
        "artifact_store_id": fake_artifact_store_id,
        "artifact_local_id": f"{test_model_artifact_id}0",
    }
    response = backend_client_admin.post("/artifacts/model_details", json=main_composite_id).raise_for_status()
    details = response.json()
    assert details["composite_id"]["artifact_store_id"] == fake_artifact_store_id
    assert details["composite_id"]["artifact_local_id"] == f"{test_model_artifact_id}0"
    assert details["display_name"] == "Test Model Checkpoint 0"
    assert details["is_available"] == True
    assert details["is_locally_compatible"] == True
    assert details["local_compatibility_detail"] is None
    assert details["tags"] == {"integration-test": None, "index": "0"}

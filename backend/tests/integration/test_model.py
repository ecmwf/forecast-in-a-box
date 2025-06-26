import time
from .conftest import fake_model_name


def test_download_model(backend_client):
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
    token_admin = response.json()["access_token"]

    headers = {"Authorization": f"Bearer {token_admin}"}
    response = backend_client.get("/model/available", headers=headers).raise_for_status()
    assert response.json() == {"": ["test"]}  # test.ckpt in tests/integration/data

    response = backend_client.get("/model", headers=headers).raise_for_status()
    assert response.json()[fake_model_name]["message"] == "Model not downloaded."

    response = backend_client.post(f"/model/{fake_model_name}/download", headers=headers).raise_for_status()
    assert response.json()["message"] == "Download started."

    i = 6
    while i > 0:
        response = backend_client.get("/model", headers=headers).raise_for_status()
        message = response.json()[fake_model_name]["message"]
        if message == "Download already completed.":
            break
        time.sleep(0.3)
        i -= 1

    assert i > 0, "Failed to download model"

    response = backend_client.get("/model/available", headers=headers).raise_for_status()
    assert fake_model_name in response.json()[""]

    backend_client.delete(f"/model/{fake_model_name}", headers=headers).raise_for_status()

    response = backend_client.get("/model", headers=headers).raise_for_status()
    assert response.json()[fake_model_name]["message"] == "Model not downloaded."

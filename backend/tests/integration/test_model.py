import time

from forecastbox.models.metadata import ControlMetadata

from .conftest import fake_model_name
from .utils import extract_auth_token_from_response, prepare_cookie_with_auth_token


def test_download_model(backend_client):
    """Downloads bunch of models in parallel, tests they succesfully appear, deletes them"""

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

    response = backend_client.get("/model/available").raise_for_status()
    # NOTE test.ckpt i expected in tests/integration/data always, its used by test_submit_job.py
    # NOTE any failure here presumably caused by previous run not finishing succ -- just clean the dir
    assert response.json() == {"": ["test"]}

    response = backend_client.get("/model").raise_for_status()

    assert fake_model_name in response.json()
    assert response.json()[fake_model_name]["download"]["message"] == "Model not downloaded."

    # NOTE we launch `parallelism`+1 downloads in parallel, actively wait for the last one to finish, then check
    # all were finished ok -- just for code simplicity

    parallelism = 3
    for e in range(parallelism):
        response = backend_client.post(f"/model/{fake_model_name}{e}/download").raise_for_status()
        assert response.json()["message"] == "Download started."
    response = backend_client.post(f"/model/{fake_model_name}/download").raise_for_status()
    assert response.json()["message"] == "Download started."

    i = 128
    while i > 0:
        response = backend_client.get("/model").raise_for_status()
        message = response.json()[fake_model_name]["download"]["message"]
        if message == "Download already completed.":
            break
        time.sleep(0.05)
        i -= 1

    assert i > 0, "Failed to download model"


    response = backend_client.get("/model/available").raise_for_status()
    assert fake_model_name in response.json()[""]
    for e in range(parallelism):
        assert fake_model_name + str(e) in response.json()[""]
        backend_client.delete(f"/model/{fake_model_name}{e}").raise_for_status()

    metadata = ControlMetadata()
    expected = '{"detail":"failed to edit model metadata due to BadZipFile(\'File is not a zip file\')"}'
    response = backend_client.patch(f"/model/{fake_model_name}/metadata", json=metadata.model_dump())
    assert response.status_code == 400
    assert response.text == expected
    # we try twice to test that the concurrent lock has been lifted
    response = backend_client.patch(f"/model/{fake_model_name}/metadata", json=metadata.model_dump())
    assert response.status_code == 400
    assert response.text == expected

    backend_client.delete(f"/model/{fake_model_name}").raise_for_status()

    response = backend_client.get("/model").raise_for_status()
    assert response.json()[fake_model_name]["download"]["message"] == "Model not downloaded."

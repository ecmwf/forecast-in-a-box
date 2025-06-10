import pytest


@pytest.mark.skip(reason="requires mongodb still")
def test_register(backend_client):
    headers = {"Content-Type": "application/json"}
    data = {"email": "whatever@somewhere.org", "password": "something"}
    response = backend_client.post("/auth/register", headers=headers, json=data)
    print(response.text)
    assert response.is_success

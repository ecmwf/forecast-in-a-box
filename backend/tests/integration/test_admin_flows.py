# @pytest.mark.skip(reason="requires mongodb still")
def test_admin_flows(backend_client):
    # TODO this test is a bit flaky, because it must be executed first to ensure admin actually ending up admin
    # but then the impl itself is flaky

    # curl -XPOST -H 'Content-Type: application/json' -d '{"email": "admin@somewhere.org", "password": "something"}' localhost:8000/api/v1/auth/register
    headers = {"Content-Type": "application/json"}
    data = {"email": "admin@somewhere.org", "password": "something"}
    response = backend_client.post("/auth/register", headers=headers, json=data)
    assert response.is_success
    id_admin = response.json()["id"]

    # TOKEN=$(curl -s -XPOST -H 'Content-Type: application/x-www-form-urlencoded' --data-ascii 'username=admin@somewhere.org&password=something' localhost:8000/api/v1/auth/jwt/login | jq -r .access_token)
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    data = {"username": "admin@somewhere.org", "password": "something"}
    response = backend_client.post("/auth/jwt/login", data=data)
    assert response.is_success
    token_admin = response.json()["access_token"]

    response = backend_client.get("admin/users", headers={})
    assert not response.is_success
    # curl -H "Authorization: Bearer $TOKEN" localhost:8000/api/v1/admin/users
    headers = {"Authorization": f"Bearer {token_admin}"}
    response = backend_client.get("admin/users", headers=headers)
    assert response.is_success
    assert response.json()[0]["email"] == "admin@somewhere.org"
    response = backend_client.get(f"admin/users/{id_admin}", headers=headers)
    assert response.is_success
    assert response.json()["email"] == "admin@somewhere.org"

    headers = {"Content-Type": "application/json"}
    data = {"email": "user@somewhere.org", "password": "something"}
    response = backend_client.post("/auth/register", headers=headers, json=data)
    assert response.is_success
    id_user = response.json()["id"]

    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    data = {"username": "user@somewhere.org", "password": "something"}
    response = backend_client.post("/auth/jwt/login", data=data)
    assert response.is_success
    token_user = response.json()["access_token"]

    headers = {"Authorization": f"Bearer {token_user}"}
    response = backend_client.get("admin/users", headers=headers)
    assert not response.is_success
    response = backend_client.get(f"admin/users/{id_user}", headers=headers)
    assert not response.is_success  # NOTE maybe a bit odd? Would we want a self-info endpoint?

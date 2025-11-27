import os

from forecastbox.api.routers.admin import ConfigResponse, GetReleaseStatusResponse
from forecastbox.api.updates import Release

from .utils import extract_auth_token_from_response, prepare_cookie_with_auth_token


def test_admin_flows(backend_client):
    # TODO this test is a bit flaky, because it must be executed first to ensure admin actually ending up admin
    # but then the impl itself is flaky
    # NOTE there is additionally dependence of test_model.py on this test

    response = backend_client.get("/admin/uiConfig")
    assert response.is_success
    ConfigResponse(**response.json())

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
    token_admin = extract_auth_token_from_response(response)
    assert token_admin is not None, "Token should not be None"
    backend_client.cookies.set(**prepare_cookie_with_auth_token(token_admin))

    # curl -H "Authorization: Bearer $TOKEN" localhost:8000/api/v1/admin/users
    response = backend_client.get("admin/users")
    assert response.is_success
    assert response.json()[0]["email"] == "admin@somewhere.org"
    response = backend_client.get(f"admin/users/{id_admin}")
    assert response.is_success
    assert response.json()["email"] == "admin@somewhere.org"

    # get release
    if os.environ.get("CI_GITHUB_RATELIMIT", "no") != "yes":
        # NOTE this endpoint can fail with rate limit exceeded => we best not test in full matrix
        response = backend_client.get("/admin/release")
        assert response.is_success
        release_status = GetReleaseStatusResponse(**response.json())
        assert isinstance(release_status.local_release, Release)
        assert isinstance(release_status.local_release_age_days, int)
        assert isinstance(release_status.newest_available_release, Release)

    # register
    headers = {"Content-Type": "application/json"}
    data = {"email": "user@somewhere.org", "password": "something"}
    response = backend_client.post("/auth/register", headers=headers, json=data)
    assert response.is_success

    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    data = {"username": "user@somewhere.org", "password": "something"}
    response = backend_client.post("/auth/jwt/login", data=data)
    assert response.is_success
    backend_client.cookies.set(**prepare_cookie_with_auth_token(extract_auth_token_from_response(response)))

    response = backend_client.get("admin/users")
    assert not response.is_success
    response = backend_client.get("/users/me")
    assert response.is_success

    headers = {"Content-Type": "application/json"}
    data = {"email": "user@nowhere.org", "password": "something"}
    response = backend_client.post("/auth/register", headers=headers, json=data)
    assert response.status_code == 400

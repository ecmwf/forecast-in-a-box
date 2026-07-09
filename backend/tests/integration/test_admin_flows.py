import os

import httpx

from forecastbox.domain.admin import Release
from forecastbox.routes.admin import ConfigResponse, GetReleaseStatusResponse

from .utils import extract_auth_token_from_response, prepare_cookie_with_auth_token


def test_admin_flows(backend_client_admin: httpx.Client) -> None:
    response = backend_client_admin.get("/admin/uiConfig")
    assert response.is_success
    ConfigResponse(**response.json())

    # NOTE we dont register or login, already done in the conftest
    # curl -XPOST -H 'Content-Type: application/json' -d '{"email": "admin@somewhere.org", "password": "something"}' localhost:8000/api/v1/auth/register
    # TOKEN=$(curl -s -XPOST -H 'Content-Type: application/x-www-form-urlencoded' --data-ascii 'username=admin@somewhere.org&password=something' localhost:8000/api/v1/auth/jwt/login | jq -r .access_token)

    # curl -H "Authorization: Bearer $TOKEN" localhost:8000/api/v1/admin/users
    response = backend_client_admin.get("admin/users")
    assert response.is_success
    assert response.json()[0]["email"] == "admin@somewhere.org"
    id_admin = response.json()[0]["id"]
    response = backend_client_admin.get(f"admin/users/{id_admin}")
    assert response.is_success
    assert response.json()["email"] == "admin@somewhere.org"

    # get release
    if os.environ.get("CI_GITHUB_RATELIMIT", "no") != "yes":
        # NOTE this endpoint can fail with rate limit exceeded => we best not test in full matrix
        response = backend_client_admin.get("/admin/release")
        assert response.is_success
        release_status = GetReleaseStatusResponse(**response.json())
        assert isinstance(release_status.local_release, Release)
        assert isinstance(release_status.local_release_age_days, int)
        assert isinstance(release_status.newest_available_release, Release)

    # register a new user
    headers = {"Content-Type": "application/json"}
    data = {"email": "testAdminFlows@somewhere.org", "password": "testAdminFlowsPassword"}
    response = backend_client_admin.post("/auth/register", headers=headers, json=data)
    assert response.is_success

    with httpx.Client(base_url=str(backend_client_admin.base_url), follow_redirects=True) as backend_client_user:
        response = backend_client_user.post(
            "/auth/jwt/login", data={"username": "testAdminFlows@somewhere.org", "password": "testAdminFlowsPassword"}
        )
        token = extract_auth_token_from_response(response)
        assert token is not None, "Login has failed"
        backend_client_user.cookies.set(**prepare_cookie_with_auth_token(token))  # ty:ignore[invalid-argument-type]

        response = backend_client_user.get("admin/users")
        assert not response.is_success
        response = backend_client_user.get("/users/me")
        assert response.is_success

    headers = {"Content-Type": "application/json"}
    data = {"email": "testAdminFlows@nowhere.org", "password": "testAdminFlowsPassword"}
    response = backend_client_admin.post("/auth/register", headers=headers, json=data)
    assert response.status_code == 400, "nowhere domain should not be allowed"
    data = {"email": "testAdminFlows@somewhere.org", "password": "testAdminFlowsPassword"}
    response = backend_client_admin.post("/auth/register", headers=headers, json=data)
    assert response.status_code == 400, "second register call should fail"

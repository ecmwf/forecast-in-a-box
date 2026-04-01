import time
from collections.abc import Callable
from typing import Any


def extract_auth_token_from_response(response) -> None | str:
    """Extracts the authentication token from the response cookies.

    Will look for the `forecastbox_auth` cookie in the response,
    including in any redirects that may have occurred.

    Parameters
    ----------
    response: httpx.Response
        The HTTP response object from which to extract the token.

    Returns
    -------
    None | str
        The authentication token if found, otherwise None.
    """
    cookies = response.cookies
    if cookies:
        return cookies.get("forecastbox_auth")
    if response.history:
        for resp in response.history:
            if resp.cookies:
                return resp.cookies.get("forecastbox_auth")
    return None


def prepare_cookie_with_auth_token(token) -> dict:
    """Prepares a cookie with the authentication token.

    Parameters
    ----------
    token: str
        The authentication token to be set in the cookie.

    Returns
    -------
    dict:
        A dictionary representing the cookie with the token.
    """
    return {"name": "forecastbox_auth", "value": token}


def ensure_completed(backend_client, job_id, sleep=0.5, attempts=20):
    i = attempts
    while i > 0:
        response = backend_client.get("/job/status", timeout=10)
        assert response.is_success
        status = response.json()["progresses"][job_id]["status"]
        if status == "failed":
            raise RuntimeError(f"Job {job_id} failed: {response.json()['progresses'][job_id]['error']}")
        # TODO parse response with corresponding class, define a method `not_failed` instead
        assert status in {"submitted", "running", "completed"}
        if status == "completed":
            break
        time.sleep(sleep)
        i -= 1

    assert i > 0, f"Failed to finish job {job_id}"


def ensure_schedule_run_v2(backend_client, experiment_id: str, sleep: float = 1.0, attempts: int = 30) -> str:
    """Wait for at least one run to appear for the given schedule; return the run_id.

    Polls GET /experiment/runs/list until total > 0, up to attempts * sleep seconds.
    """
    for _ in range(attempts):
        response = backend_client.get("/experiment/runs/list", params={"experiment_id": experiment_id}, timeout=10)
        assert response.is_success, response.text
        data = response.json()
        if data["total"] > 0:
            return data["runs"][0]["run_id"]
        time.sleep(sleep)
    raise AssertionError(f"No run appeared for schedule {experiment_id} within {attempts} attempts")


def ensure_completed_v2(backend_client, job_id, sleep=0.5, attempts=20):
    i = attempts
    while i > 0:
        response = backend_client.get("/run/get", params={"run_id": job_id}, timeout=10)
        assert response.is_success, response.text
        data = response.json()
        if data["status"] == "failed":
            raise RuntimeError(f"Job {job_id} failed: {data}")
        assert data["status"] in {"submitted", "running", "completed"}, data["status"]
        if data["status"] == "completed":
            break
        time.sleep(sleep)
        i -= 1

    assert i > 0, f"Failed to finish job {job_id}"


def scheduling_endpoint_with_retries(fn: Callable[[], Any], *, attempts: int = 4, sleep: float = 0.5) -> Any:
    """Call fn() and retry on 503 Scheduler is busy, up to attempts times with sleep in between.

    fn should be a zero-argument callable that performs an HTTP request and returns the response.
    Returns the last response regardless of status; callers should assert success as usual.
    """
    response = fn()
    for _ in range(attempts - 1):
        if response.status_code != 503:
            break
        time.sleep(sleep)
        response = fn()
    return response

import time


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


def ensure_completed(backend_client, job_id, sleep=0.5):
    i = 20
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

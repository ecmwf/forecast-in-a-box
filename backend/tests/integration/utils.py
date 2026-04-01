import time
from collections.abc import Callable
from typing import Any, TypeVar, cast

import httpx

T = TypeVar("T")


def retry_until(
    do_action: Callable[[], Any],
    verify_ok: Callable[[Any], T | None],
    *,
    attempts: int = 20,
    sleep: float = 0.5,
    error_msg: str = "Max attempts exceeded",
) -> T:
    """Repeatedly call do_action() and pass the result to verify_ok().

    verify_ok should return None to indicate "not yet done", raise to signal an
    error, or return any truthy value to indicate success. That truthy value is
    then returned by retry_until. Raises AssertionError after exhausting all
    attempts.
    """
    for _ in range(attempts):
        result = do_action()
        ok = verify_ok(result)
        if ok is not None:
            return ok  # ty: ignore
        time.sleep(sleep)
    raise AssertionError(error_msg)


def extract_auth_token_from_response(response: httpx.Response) -> None | str:
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


def prepare_cookie_with_auth_token(token: str) -> dict:
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


def ensure_completed(backend_client: httpx.Client, job_id: str, sleep: float = 0.5, attempts: int = 20) -> None:
    def do_action() -> Any:
        response = backend_client.get("/job/status", timeout=10)
        assert response.is_success
        return response.json()["progresses"][job_id]

    def verify_ok(progress: Any) -> bool | None:
        if progress["status"] == "failed":
            raise RuntimeError(f"Job {job_id} failed: {progress['error']}")
        # TODO parse response with corresponding class, define a method `not_failed` instead
        assert progress["status"] in {"submitted", "running", "completed"}
        return True if progress["status"] == "completed" else None

    retry_until(do_action, verify_ok, attempts=attempts, sleep=sleep, error_msg=f"Failed to finish job {job_id}")


def ensure_schedule_run_v2(backend_client: httpx.Client, experiment_id: str, sleep: float = 1.0, attempts: int = 30) -> str:
    """Wait for at least one run to appear for the given schedule; return the run_id.

    Polls GET /experiment/runs/list until total > 0, up to attempts * sleep seconds.
    """

    def do_action() -> Any:
        response = backend_client.get("/experiment/runs/list", params={"experiment_id": experiment_id}, timeout=10)
        assert response.is_success, response.text
        return response.json()

    def verify_ok(data: Any) -> str | None:
        return data["runs"][0]["run_id"] if data["total"] > 0 else None

    return cast(
        str,
        retry_until(
            do_action,
            verify_ok,
            attempts=attempts,
            sleep=sleep,
            error_msg=f"No run appeared for schedule {experiment_id} within {attempts} attempts",
        ),
    )


def scheduling_endpoint_with_retries(fn: Callable[[], Any], *, attempts: int = 4, sleep: float = 0.5) -> Any:
    """Call fn() and retry on 503 Scheduler is busy, up to attempts times with sleep in between.

    fn should be a zero-argument callable that performs an HTTP request and returns the response.
    Raises AssertionError if all attempts return 503; callers should assert success as usual.
    """
    return retry_until(
        fn, lambda r: r if r.status_code != 503 else None, attempts=attempts, sleep=sleep, error_msg="Scheduler busy after all retries"
    )

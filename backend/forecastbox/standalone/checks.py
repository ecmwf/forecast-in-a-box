"""Liveness/readiness checks for the backend/gateway instances"""

import logging
import time
from collections.abc import Callable

import httpx
from cascade.low.func import assert_never
from forecastbox.config import FIABConfig, StatusMessage
from forecastbox.standalone.procs import ChildProcessGroup

logger = logging.getLogger(__name__)

CallResult = httpx.Response|httpx.HTTPError
def _call_succ(response: CallResult, url: str) -> bool:
    if isinstance(response, httpx.Response):
        if response.status_code == 200:
            return True
        else:
            raise ValueError(f"failure on {url}: {response}")
    elif isinstance(response, httpx.ConnectError):
        return False
    elif isinstance(response, httpx.HTTPError):
        raise ValueError(f"failure on {url}: {repr(response)}")
    else:
        assert_never(response)

class StartupError(ValueError):
    pass

def _wait_for(client: httpx.Client, url: str, attempts: int, condition: Callable[[CallResult, str], bool]) -> None:
    """Calls /status endpoint, retry on ConnectError"""
    i = 0
    while i < attempts:
        logger.debug(f"waiting for {url}, with {i}/{attempts} attempts")
        try:
            response = client.get(url)
            if condition(response, url):
                return
        except httpx.HTTPError as e:
            if condition(e, url):
                return
        i += 1
        time.sleep(2)
    raise StartupError(f"failure on {url}: no more retries")


def check_backend_ready(config: FIABConfig, handles: ChildProcessGroup|None = None, attempts: int = 20, spawn_gateway: bool=True):
    try:
        with httpx.Client() as client:
            _wait_for(client, config.api.local_url() + "/api/v1/status", attempts, _call_succ)
            if spawn_gateway:
                client.post(config.api.local_url() + "/api/v1/gateway/start").raise_for_status()
            if config.auth.passthrough:
                client.post(config.api.local_url() + "/api/v1/model/flush").raise_for_status()
            gw_check = lambda resp, _: resp.raise_for_status().text == f"\"{StatusMessage.gateway_running}\""
            _wait_for(client, config.api.local_url() + "/api/v1/gateway/status", attempts, gw_check)
    except StartupError as e:
        logger.error(f"failed to start the backend: {e}")
        if handles is not None:
            handles.shutdown()
        raise

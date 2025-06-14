import tempfile
import pytest
from forecastbox.standalone.entrypoint import launch_all
import httpx
from forecastbox.config import FIABConfig
import pathlib


@pytest.fixture(scope="session")
def backend_client() -> httpx.Client:
    try:
        td = tempfile.TemporaryDirectory()
        config = FIABConfig()
        config.db.sqlite_userdb_path = f"{td.name}/user.db"
        config.api.data_path = str(pathlib.Path(__file__).parent / "data")
        handles = launch_all(config)
        client = httpx.Client(base_url=config.api.api_url + "/api/v1")
        yield client
    finally:
        td.cleanup()
        client.close()
        handles.shutdown()

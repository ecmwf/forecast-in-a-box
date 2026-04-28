import os
import pathlib
import socket
import socketserver
import tempfile
import time
from http.server import SimpleHTTPRequestHandler
from multiprocessing import Event, Process
from typing import Any, Generator

import httpx
import pytest
from fiab_core.artifacts import ArtifactStoreId
from fiab_core.fable import PluginCompositeId, PluginId, PluginStoreId
from pydantic import SecretStr

import forecastbox.utility.config
from forecastbox.entrypoint.main import launch_all
from forecastbox.utility.config import ArtifactStoreConfig, FIABConfig, PluginCompositeIdReadable, PluginSettings, PluginStoreConfig

from .utils import extract_auth_token_from_response, prepare_cookie_with_auth_token

fake_artifact_registry_port = 12001
fake_artifact_store_id = "test_store"
fake_artifact_checkpoint_id = "test_checkpoint"
fake_artifact_checkpoint_small_id = "small_checkpoint"
testPluginId = PluginCompositeIdReadable.from_str("localTest:single")


class FakeArtifactRegistry(SimpleHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/artifacts.json":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()

            def make_artifact(i: int) -> dict:
                checkpoint_id = f"{fake_artifact_checkpoint_id}{i}"
                return {
                    "url": f"http://localhost:{fake_artifact_registry_port}/{checkpoint_id}",
                    "display_name": f"Test Model Checkpoint {i}",
                    "display_author": "Test Author",
                    "display_description": f"A test model checkpoint {i} for integration tests",
                    "comment": "",
                    "disk_size_bytes": 1024,
                    "pip_package_constraints": ["torch>=2.0.0"],
                    "supported_platforms": ["linux", "macos"],
                    "output_qube": {"test": "qube"},
                    "input_characteristics": ["test_input"],
                    "timestep": "1h",
                }

            small_artifact = {
                "url": f"http://localhost:{fake_artifact_registry_port}/{fake_artifact_checkpoint_small_id}",
                "display_name": "Small Test Checkpoint",
                "display_author": "Test Author",
                "display_description": "A small test checkpoint for artifact runtime dependency tests",
                "comment": "",
                "disk_size_bytes": 64,
                "pip_package_constraints": [],
                "supported_platforms": ["linux", "macos"],
                "output_qube": {},
                "input_characteristics": [],
                "timestep": "1h",
            }

            catalog = {
                "display_name": "Test Artifact Store",
                "artifacts": {
                    **{f"{fake_artifact_checkpoint_id}{i}": make_artifact(i) for i in range(4)},
                    fake_artifact_checkpoint_small_id: small_artifact,
                },
            }
            import json

            self.wfile.write(json.dumps(catalog).encode("utf-8"))
        elif self.path == f"/{fake_artifact_checkpoint_small_id}":
            data = b"x" * 64
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            self.wfile.flush()
            print(f"artifact download done for {self.path}")
        elif self.path.startswith(f"/{fake_artifact_checkpoint_id}"):
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Transfer-Encoding", "chunked")
            chunk_size = 256
            chunks = 4
            self.send_header("Content-Length", str(chunk_size * chunks))
            self.end_headers()
            chunk = b"x" * chunk_size
            chunk_header = hex(len(chunk))[2:].encode("ascii")
            for _ in range(chunks):
                time.sleep(0.1)
                self.wfile.write(chunk_header + b"\r\n")
                self.wfile.write(chunk + b"\r\n")
                self.wfile.flush()
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
            print(f"artifact download done for {self.path}")
        else:
            self.send_error(404, f"Not Found: {self.path}")


def run_artifact_registry(shutdown_event: Any) -> None:
    server_address = ("", fake_artifact_registry_port)

    class WhyExposeFieldsInConstructorWhenYouCanSubclass(socketserver.ThreadingTCPServer):
        allow_reuse_address = True

    with WhyExposeFieldsInConstructorWhenYouCanSubclass(server_address, FakeArtifactRegistry) as httpd:
        httpd.timeout = 1
        while not shutdown_event.is_set():
            httpd.handle_request()
        httpd.shutdown()


@pytest.fixture(scope="session")
def backend_client() -> Generator[httpx.Client, None, None]:
    td = None
    td_data = None
    handles = None
    shutdown_event_artifacts = None
    p_artifacts = None
    client = None
    try:
        td = tempfile.TemporaryDirectory()
        td_data = tempfile.TemporaryDirectory()
        os.environ["FIAB_ROOT"] = td.name
        os.environ["FIAB_TEST_FRONTEND"] = str(pathlib.Path(__file__).parent / "static")
        (pathlib.Path(td.name) / "pylock.toml.timestamp").write_text("1761908420:d0.0.1")
        # we need to monkeypath this, because of eager import this was already initialised
        # to user's personal config file
        forecastbox.utility.config.fiab_home = pathlib.Path(td.name)

        config = FIABConfig()
        config.auth.jwt_secret = SecretStr("x" * 32)
        config.api.uvicorn_port = 30645
        config.cascade.cascade_url = "tcp://localhost:30644"
        config.db.sqlite_userdb_path = f"{td.name}/user.db"
        config.db.sqlite_jobdb_path = f"{td.name}/job.db"
        config.api.data_path = td_data.name
        config.api.allow_scheduler = True
        config.product.artifact_stores = {
            ArtifactStoreId(fake_artifact_store_id): ArtifactStoreConfig(
                url=f"http://localhost:{fake_artifact_registry_port}/artifacts.json",
                method="file",
            )
        }
        config.product.plugin_stores = {
            PluginStoreId("localTest"): PluginStoreConfig(
                url="file://../../packages/fiab-plugin-test",
                method="localSingle",
            ),
        }
        config.product.plugins = {
            testPluginId: PluginSettings(
                pip_source="-e file://../../packages/fiab-plugin-test",
                module_name="fiab_plugin_test",
            ),
        }

        config.general.launch_browser = False
        config.auth.domain_allowlist_registry = ["somewhere.org"]
        config.auth.passthrough = False

        # Start fake artifact registry before launching the app
        shutdown_event_artifacts = Event()
        p_artifacts = Process(target=run_artifact_registry, args=(shutdown_event_artifacts,))
        p_artifacts.start()

        handles = launch_all(config)
        client = httpx.Client(base_url=config.api.local_url() + "/api/v1", follow_redirects=True)
        yield client
    finally:
        if client is not None:
            client.close()
        if shutdown_event_artifacts is not None:
            shutdown_event_artifacts.set()
        if p_artifacts is not None:
            p_artifacts.join(timeout=3)
            if p_artifacts.is_alive():
                p_artifacts.terminate()
            p_artifacts.join(timeout=3)
            if p_artifacts.is_alive():
                p_artifacts.kill()
        if handles is not None:
            handles.shutdown()
        if td is not None:
            td.cleanup()
        if td_data is not None:
            td_data.cleanup()


@pytest.fixture(scope="session")
def backend_client_with_auth(backend_client: httpx.Client) -> Generator[httpx.Client, None, None]:
    headers = {"Content-Type": "application/json"}
    data = {"email": "authenticated_user@somewhere.org", "password": "something"}
    response = backend_client.post("/auth/register", headers=headers, json=data)
    assert response.is_success
    response = backend_client.post("/auth/jwt/login", data={"username": "authenticated_user@somewhere.org", "password": "something"})
    token = extract_auth_token_from_response(response)
    assert token is not None, "Token should not be None"
    backend_client.cookies.set(**prepare_cookie_with_auth_token(token))

    response = backend_client.get("/users/me")
    assert response.is_success, "Failed to authenticate user"
    yield backend_client

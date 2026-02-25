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

import forecastbox.config
from forecastbox.config import ArtifactStoreConfig, FIABConfig
from forecastbox.standalone.entrypoint import launch_all

from .utils import extract_auth_token_from_response, prepare_cookie_with_auth_token

fake_model_name = "themodel"
fake_repository_port = 12000
fake_artifact_registry_port = 12001
fake_artifact_store_id = "test_store"
fake_artifact_checkpoint_id = "test_checkpoint"


class FakeModelRepository(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith(f"/{fake_model_name}"):
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Transfer-Encoding", "chunked")
            chunk_size = 256
            chunks = 8
            self.send_header("Content-Length", str(chunk_size * chunks))
            self.end_headers()
            chunk = b"x" * chunk_size
            chunk_header = hex(len(chunk))[2:].encode("ascii")  # Get hex size of chunk, remove '0x'
            for _ in range(chunks):
                time.sleep(0.3)
                self.wfile.write(chunk_header + b"\r\n")
                self.wfile.write(chunk + b"\r\n")
                self.wfile.flush()
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()

            print(f"sending done for {self.path}")
        elif self.path == "/MANIFEST":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            manifest_content = f"{fake_model_name}"
            self.wfile.write(manifest_content.encode("utf-8"))
        else:
            self.send_error(404, f"Not Found: {self.path}")


class FakeArtifactRegistry(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/artifacts.json":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            catalog = {
                "display_name": "Test Artifact Store",
                "artifacts": {
                    fake_artifact_checkpoint_id: {
                        "url": f"http://localhost:{fake_artifact_registry_port}/{fake_artifact_checkpoint_id}",
                        "display_name": "Test Model Checkpoint",
                        "display_author": "Test Author",
                        "display_description": "A test model checkpoint for integration tests",
                        "comment": "",
                        "disk_size_bytes": 2048,
                        "pip_package_constraints": ["torch>=2.0.0"],
                        "supported_platforms": ["linux", "macos"],
                        "output_characteristics": ["test_output"],
                        "input_characteristics": ["test_input"],
                    },
                    f"{fake_artifact_checkpoint_id}0": {
                        "url": f"http://localhost:{fake_artifact_registry_port}/{fake_artifact_checkpoint_id}0",
                        "display_name": "Test Model Checkpoint 0",
                        "display_author": "Test Author",
                        "display_description": "A test model checkpoint 0 for integration tests",
                        "comment": "",
                        "disk_size_bytes": 2048,
                        "pip_package_constraints": ["torch>=2.0.0"],
                        "supported_platforms": ["linux", "macos"],
                        "output_characteristics": ["test_output"],
                        "input_characteristics": ["test_input"],
                    },
                    f"{fake_artifact_checkpoint_id}1": {
                        "url": f"http://localhost:{fake_artifact_registry_port}/{fake_artifact_checkpoint_id}1",
                        "display_name": "Test Model Checkpoint 1",
                        "display_author": "Test Author",
                        "display_description": "A test model checkpoint 1 for integration tests",
                        "comment": "",
                        "disk_size_bytes": 2048,
                        "pip_package_constraints": ["torch>=2.0.0"],
                        "supported_platforms": ["linux", "macos"],
                        "output_characteristics": ["test_output"],
                        "input_characteristics": ["test_input"],
                    },
                    f"{fake_artifact_checkpoint_id}2": {
                        "url": f"http://localhost:{fake_artifact_registry_port}/{fake_artifact_checkpoint_id}2",
                        "display_name": "Test Model Checkpoint 2",
                        "display_author": "Test Author",
                        "display_description": "A test model checkpoint 2 for integration tests",
                        "comment": "",
                        "disk_size_bytes": 2048,
                        "pip_package_constraints": ["torch>=2.0.0"],
                        "supported_platforms": ["linux", "macos"],
                        "output_characteristics": ["test_output"],
                        "input_characteristics": ["test_input"],
                    },
                },
            }
            import json

            self.wfile.write(json.dumps(catalog).encode("utf-8"))
        elif self.path.startswith(f"/{fake_artifact_checkpoint_id}"):
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Transfer-Encoding", "chunked")
            chunk_size = 256
            chunks = 8
            self.send_header("Content-Length", str(chunk_size * chunks))
            self.end_headers()
            chunk = b"x" * chunk_size
            chunk_header = hex(len(chunk))[2:].encode("ascii")
            for _ in range(chunks):
                time.sleep(0.3)
                self.wfile.write(chunk_header + b"\r\n")
                self.wfile.write(chunk + b"\r\n")
                self.wfile.flush()
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
            print(f"artifact download done for {self.path}")
        else:
            self.send_error(404, f"Not Found: {self.path}")


def run_repository(shutdown_event: Any):  # TODO typing -- is `Event` but thats not correct
    server_address = ("", fake_repository_port)

    # We need to allow reuse address on the socket, because kernel helpfully keeps it in zombie
    # for like a minute or two. Reuse is generally dangerous because we may get packets from
    # a queue, but in this get-only repository its a legit thing
    class WhyExposeFieldsInConstructorWhenYouCanSubclass(socketserver.ThreadingTCPServer):
        allow_reuse_address = True

    with WhyExposeFieldsInConstructorWhenYouCanSubclass(server_address, FakeModelRepository) as httpd:
        # NOTE dont serve forever, doesnt free the port up correctly
        # httpd.serve_forever()
        httpd.timeout = 1
        while not shutdown_event.is_set():
            httpd.handle_request()
        httpd.shutdown()


def run_artifact_registry(shutdown_event: Any):
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
    handles = None
    shutdown_event = None
    shutdown_event_artifacts = None
    p = None
    p_artifacts = None
    client = None
    try:
        td = tempfile.TemporaryDirectory()
        os.environ["FIAB_ROOT"] = td.name
        (pathlib.Path(td.name) / "pylock.toml.timestamp").write_text("1761908420:d0.0.1")
        # we need to monkeypath this, because of eager import this was already initialised
        # to user's personal config file
        forecastbox.config.fiab_home = pathlib.Path(td.name)
        config = FIABConfig()
        config.api.uvicorn_port = 30645
        config.cascade.cascade_url = "tcp://localhost:30644"
        config.db.sqlite_userdb_path = f"{td.name}/user.db"
        config.db.sqlite_jobdb_path = f"{td.name}/job.db"
        config.api.data_path = str(pathlib.Path(__file__).parent / "data")
        config.api.model_repository = f"http://localhost:{fake_repository_port}"
        config.product.artifact_stores = {
            fake_artifact_store_id: ArtifactStoreConfig(
                url=f"http://localhost:{fake_artifact_registry_port}/artifacts.json",
                method="file",
            )
        }
        config.general.launch_browser = False
        config.auth.domain_allowlist_registry = ["somewhere.org"]
        config.auth.passthrough = False

        # Start fake artifact registry before launching the app
        shutdown_event_artifacts = Event()
        p_artifacts = Process(target=run_artifact_registry, args=(shutdown_event_artifacts,))
        p_artifacts.start()

        # Start fake model repository
        shutdown_event = Event()
        p = Process(target=run_repository, args=(shutdown_event,))
        p.start()

        # Give the servers a moment to start
        time.sleep(0.5)

        handles = launch_all(config)
        client = httpx.Client(base_url=config.api.local_url() + "/api/v1", follow_redirects=True)
        yield client
    finally:
        if client is not None:
            client.close()
        if shutdown_event is not None:
            shutdown_event.set()
        if shutdown_event_artifacts is not None:
            shutdown_event_artifacts.set()
        if p is not None:
            p.join(timeout=3)
            if p.is_alive():
                p.terminate()
            p.join(timeout=3)
            if p.is_alive():
                p.kill()
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


@pytest.fixture(scope="session")
def backend_client_with_auth(backend_client):
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

import tempfile
import pytest
from forecastbox.standalone.entrypoint import launch_all
import httpx
from forecastbox.config import FIABConfig
import pathlib
from http.server import SimpleHTTPRequestHandler
import socketserver
from multiprocessing import Process
import time

from .utils import extract_auth_token_from_response, prepare_cookie_with_auth_token

fake_model_name = "themodel"
fake_repository_port = 12000


class FakeModelRepository(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith(f"/{fake_model_name}"):
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Transfer-Encoding", "chunked")
            chunk_size = 256
            chunks = 8
            self.send_header("Content-Length", chunk_size * chunks)
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


def run_repository():
    server_address = ("", fake_repository_port)
    with socketserver.ThreadingTCPServer(server_address, FakeModelRepository) as httpd:
        httpd.serve_forever()


@pytest.fixture(scope="session")
def backend_client() -> httpx.Client:
    try:
        td = tempfile.TemporaryDirectory()
        config = FIABConfig()
        config.api.api_url = "http://localhost:30645"
        config.cascade.cascade_url = "tcp://localhost:30644"
        config.db.sqlite_userdb_path = f"{td.name}/user.db"
        config.db.sqlite_jobdb_path = f"{td.name}/job.db"
        config.api.data_path = str(pathlib.Path(__file__).parent / "data")
        config.api.model_repository = f"http://localhost:{fake_repository_port}"
        handles = launch_all(config)
        p = Process(target=run_repository)
        p.start()
        client = httpx.Client(base_url=config.api.api_url + "/api/v1", follow_redirects=True)
        yield client
    finally:
        p.terminate()
        td.cleanup()
        client.close()
        handles.shutdown()
        p.join()


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

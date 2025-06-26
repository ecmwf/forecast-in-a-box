import tempfile
import pytest
from forecastbox.standalone.entrypoint import launch_all
import httpx
from forecastbox.config import FIABConfig
import pathlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from multiprocessing import Process

fake_model_name = "themodel"
fake_repository_port = 12000


class FakeModelRepository(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == f"/{fake_model_name}.ckpt":
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", 1024)
            self.end_headers()
            chunk = b"x" * 256
            for _ in range(4):
                self.wfile.write(chunk)
        elif self.path == "/MANIFEST":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            manifest_content = f"{fake_model_name}.ckpt"
            self.wfile.write(manifest_content.encode("utf-8"))
        else:
            self.send_error(404, f"Not Found: {self.path}")


def run_repository(server_class=HTTPServer, handler_class=FakeModelRepository):
    server_address = ("", fake_repository_port)
    httpd = server_class(server_address, handler_class)
    httpd.serve_forever()


@pytest.fixture(scope="session")
def backend_client() -> httpx.Client:
    try:
        td = tempfile.TemporaryDirectory()
        config = FIABConfig()
        config.api.api_url = "http://localhost:30645"
        config.db.sqlite_userdb_path = f"{td.name}/user.db"
        config.db.sqlite_jobdb_path = f"{td.name}/job.db"
        config.api.data_path = str(pathlib.Path(__file__).parent / "data")
        config.api.model_repository = f"http://localhost:{fake_repository_port}"
        handles = launch_all(config)
        p = Process(target=run_repository)
        p.start()
        client = httpx.Client(base_url=config.api.api_url + "/api/v1")
        yield client
    finally:
        p.terminate()
        td.cleanup()
        client.close()
        handles.shutdown()
        p.join()

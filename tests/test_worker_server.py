from forecastbox.worker.server import app
from fastapi.testclient import TestClient

client = TestClient(app)


def test_status():
	response = client.get("/status")
	assert response.status_code == 200
	assert response.text == '"ok"'

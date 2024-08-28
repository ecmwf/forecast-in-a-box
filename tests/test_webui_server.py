from forecastbox.web_ui.server import app
from fastapi.testclient import TestClient

client = TestClient(app)


def test_status():
	response = client.get("/status")
	assert response.status_code == 200
	assert response.text == '"ok"'


def test_index():
	# TODO mock the StaticExecutionContext somehow -- the URLs for Controller. Ideally mock whole controller
	# response = client.get("/")
	# assert response.status_code == 200
	assert True

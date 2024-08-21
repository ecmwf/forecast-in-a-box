from forecastbox.controller.server import app
from forecastbox.api.common import JobStatus, JobStatusEnum, WorkerRegistration, WorkerId, TaskDAG, Task, JobTypeEnum, DatasetId
from fastapi.testclient import TestClient

client = TestClient(app)


def test_status():
	response = client.get("/status")
	assert response.status_code == 200
	assert response.text == '"ok"'


def test_job_not_found():
	response = client.get("/job/status/not-existent")
	assert response.status_code == 404
	# TODO this is not matching what we raise in the code -- some fastapi quirk. Fix.
	assert response.json() == {"detail": "Not Found"}


def test_job_submit():
	task = Task(name="step1", static_params={}, dataset_inputs={}, entrypoint="entrypoint", output_name=DatasetId(dataset_id="output"))
	job_definition = TaskDAG(job_type=JobTypeEnum.hello_world, tasks=[task], output_id=DatasetId(dataset_id="output"))
	r1 = client.put("/jobs/submit", json=job_definition.model_dump())
	assert r1.status_code == 200
	r1status = JobStatus(**r1.json())
	assert r1status.job_id.job_id is not None
	assert r1status.status == JobStatusEnum.submitted
	r2 = client.get(f"/jobs/status/{r1status.job_id.job_id}")
	assert r2.status_code == 200
	r2status = JobStatus(**r2.json())
	assert r2status.job_id.job_id == r1status.job_id.job_id


def test_worker_registration():
	registration = WorkerRegistration.from_raw("http://localhost:8000")
	response_raw = client.put("/workers/register", json=registration.model_dump())
	assert response_raw.status_code == 200
	worker_id = WorkerId(**response_raw.json())
	assert worker_id.worker_id is not None

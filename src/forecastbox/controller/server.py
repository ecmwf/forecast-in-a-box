"""
The fast-api server providing the controller's rest api

endpoints:
  /jobs
  [put] submit(job_name: str/enum, job_params: dict[str, Any]) -> JobId
  [get] status(job_id: JobId) -> JobStatus
    ↑ does not retrieve the result itself. Instead, JobStatus contains optional url where results can be retrieved from
  /workers
  [put] register(hostname: str) -> WorkerId
  [post] update(worker_id: WorkerId, job_id: JobId, job_status: JobStatus) -> Ok
"""

from fastapi import FastAPI
import logging
import uuid
from forecastbox.api.controller import JobDefinition, JobStatus, JobId, JobStatusEnum
import datetime as dt

logger = logging.getLogger("uvicorn." + __name__)  # TODO instead configure uvicorn the same as the app
app = FastAPI()


@app.api_route("/status", methods=["GET", "HEAD"])
async def status_check() -> str:
	return "ok"


@app.api_route("/jobs/submit", methods=["PUT"])
async def job_submit(definition: JobDefinition) -> JobStatus:
	return JobStatus(
		job_id=JobId(job_id=str(uuid.uuid4())),
		created_at=dt.datetime.utcnow(),
		updated_at=dt.datetime.utcnow(),
		status=JobStatusEnum.submitted,
	)

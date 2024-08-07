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

from fastapi import FastAPI, HTTPException
import logging
from forecastbox.api.controller import JobDefinition, JobStatus, JobId
import forecastbox.controller.db as db

logger = logging.getLogger("uvicorn." + __name__)  # TODO instead configure uvicorn the same as the app
app = FastAPI()


@app.api_route("/status", methods=["GET", "HEAD"])
async def status_check() -> str:
	return "ok"


@app.api_route("/jobs/submit", methods=["PUT"])
async def job_submit(definition: JobDefinition) -> JobStatus:
	return db.new_job(definition)


@app.api_route("/jobs/status/{job_id}", methods=["GET"])
async def job_status(job_id: str) -> JobStatus:
	maybe_status = db.get_status(JobId(job_id=job_id))
	if maybe_status is None:
		raise HTTPException(status_code=404, detail="JobId not known")
	else:
		return maybe_status


# TODO workers api: register, update

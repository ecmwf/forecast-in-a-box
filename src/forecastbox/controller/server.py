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

from fastapi import FastAPI, HTTPException, BackgroundTasks
import logging
from forecastbox.api.controller import JobDefinition, JobStatus, JobId, WorkerId, WorkerRegistration
import forecastbox.controller.db as db

logger = logging.getLogger("uvicorn." + __name__)  # TODO instead configure uvicorn the same as the app
app = FastAPI()


@app.api_route("/status", methods=["GET", "HEAD"])
async def status_check() -> str:
	return "ok"


@app.api_route("/jobs/submit", methods=["PUT"])
async def job_submit(definition: JobDefinition, background_tasks: BackgroundTasks) -> JobStatus:
	status = db.job_submit(definition)
	background_tasks.add_task(db.job_assign, status.job_id.job_id)
	return status


@app.api_route("/jobs/status/{job_id}", methods=["GET"])
async def job_status(job_id: str) -> JobStatus:
	maybe_status = db.job_status(JobId(job_id=job_id))
	if maybe_status is None:
		raise HTTPException(status_code=404, detail="JobId not known")
	else:
		return maybe_status


@app.api_route("/workers/register", methods=["PUT"])
async def worker_register(worker_registration: WorkerRegistration) -> WorkerId:
	return db.worker_register(worker_registration.url_raw())


@app.api_route("/jobs/update/{worker_id}", methods=["POST"])
def job_update(job_status: JobStatus) -> JobStatus:
	# TODO consistency check on the worker-job assignment
	# TODO heartbeat for the worker
	return db.job_update(job_status)


# TODO some workers heartbeat?

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
from forecastbox.api.common import TaskDAG, JobStatus, JobId, WorkerId, WorkerRegistration, JobStatusUpdate
from cascade.v2.core import JobInstance, Host, Environment
import cascade.v2.scheduler as scheduler
import forecastbox.controller.db as db

logger = logging.getLogger(__name__)
app = FastAPI()


@app.api_route("/status", methods=["GET", "HEAD"])
async def status_check() -> str:
	return "ok"


@app.api_route("/jobs/submit", methods=["PUT"])
async def job_submit(definition: TaskDAG, background_tasks: BackgroundTasks) -> JobStatus:
	status = db.job_submit(definition)
	background_tasks.add_task(db.job_assign, status.job_id.job_id)
	return status


@app.api_route("/jobs/cascade_submit", methods=["PUT"])
async def cascade_submit(job_instance: JobInstance, background_tasks: BackgroundTasks) -> JobStatus:
	environment = Environment(hosts={k: v.params for k, v in db.worker_db.items()})
	schedule = scheduler.schedule(job_instance, environment).get_or_raise()
	status = db.cascade_submit(job_instance, schedule)
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
	worker = db.Worker(
		url=worker_registration.url_raw(),
		params=Host(
			memory_mb=worker_registration.memory_mb,
		),
	)
	return db.worker_register(worker)


@app.api_route("/jobs/update/{worker_id}", methods=["POST"])
def job_update(job_status: JobStatusUpdate) -> JobStatus:
	# TODO consistency check on the worker-job assignment
	# TODO heartbeat for the worker
	return db.job_update(job_status)

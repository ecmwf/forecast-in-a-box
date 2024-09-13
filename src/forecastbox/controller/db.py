"""
In-memory persistence for keeping track of workers (their hostname, status) and jobs (worker they run on, status).

Not immediately scalable -- we'd need to launch this as a standalone process to separate from the uvicorn workers.
Or rewrite controller to rust
"""

import logging
import httpx
import uuid
from dataclasses import dataclass
from typing import Optional
from forecastbox.api.common import TaskDAG, JobStatus, JobId, JobStatusEnum, WorkerId, JobStatusUpdate
from forecastbox.api.adapter import cascade2fiab
from cascade.v2.core import JobInstance, Schedule
import forecastbox.scheduler as scheduler
import datetime as dt

logger = logging.getLogger(__name__)


@dataclass
class Job:
	status: JobStatus
	definition: Optional[TaskDAG]
	worker_id: Optional[WorkerId]


job_db: dict[str, Job] = {}


@dataclass
class Worker:
	url: str


worker_db: dict[str, Worker] = {}


def job_status(job_id: JobId) -> Optional[JobStatus]:
	maybe_job = job_db.get(job_id.job_id, None)
	if maybe_job is None:
		return None
	else:
		return maybe_job.status


def cascade_submit(job_instance: JobInstance, schedule: Schedule) -> JobStatus:
	job_id = str(uuid.uuid4())
	status = JobStatus(
		job_id=JobId(job_id=job_id),
		created_at=dt.datetime.utcnow(),
		updated_at=dt.datetime.utcnow(),
		status=JobStatusEnum.submitted,
		status_detail="",
		result=None,
	)

	if missing := set(schedule.host_task_queues.keys()) - worker_db.keys():
		status.status = JobStatusEnum.failed
		status.status_detail = f"unknown workers in schedule: {', '.join(missing)}"
		return status

	maybe_dag = cascade2fiab(job_instance, schedule)
	if maybe_dag.e:
		status.status = JobStatusEnum.failed
		status.status_detail = f"failure in conversion: {', '.join(maybe_dag.e)}"
		return status

	job_db[job_id] = Job(status, definition=maybe_dag.t, worker_id=None)
	return status


def job_submit(definition: TaskDAG) -> JobStatus:
	job_id = str(uuid.uuid4())
	status = JobStatus(
		job_id=JobId(job_id=job_id),
		created_at=dt.datetime.utcnow(),
		updated_at=dt.datetime.utcnow(),
		status=JobStatusEnum.submitted,
		status_detail="",
		result=None,
	)
	job_db[job_id] = Job(status=status, definition=definition, worker_id=None)

	return status


async def job_assign(job_id: str) -> None:
	# TODO the httpx part should not be in this module
	if not worker_db:
		# TODO sleep-retry-or-fail
		logger.error("not enough workers")
		# TODO some counter/issue
		return
	worker_id = list(worker_db.keys())[0]
	url = worker_db[worker_id].url
	task_dag = job_db[job_id].definition
	if not task_dag:
		# TODO some counter/issue
		if job_db[job_id].status.status != JobStatusEnum.failed:
			logger.error(f"job without task but not failed: {job_id}")
		return

	schedule = scheduler.linearize(task_dag)

	async with httpx.AsyncClient() as client:  # TODO pool the client
		try:
			response = await client.put(f"{url}/jobs/submit/{job_id}", json=schedule.model_dump())
		except Exception:
			# TODO sleep-retry-or-fail
			logger.exception("failed to submit to worker")
			return
		if response.status_code != httpx.codes.OK:
			# TODO sleep-retry-or-fail
			logger.error(f"failed to submit to worker: {response}")
			return
	job_db[job_id].worker_id = WorkerId(worker_id=worker_id)
	update = JobStatusUpdate(job_id=JobId(job_id=job_id), status=JobStatusEnum.assigned)
	job_update(update)


def job_update(status_update: JobStatusUpdate) -> JobStatus:
	status = job_db[status_update.job_id.job_id].status  # or copy and then replace? Use pyrsistent?
	if status_update.task_name:
		if JobStatusEnum.valid_transition(status.stages.get(status_update.task_name, None), status_update.status):
			status.stages[status_update.task_name] = status_update.status
	else:
		if JobStatusEnum.valid_transition(status.status, status_update.status):
			status.status = status_update.status
	if status_update.result:
		status.result = status_update.result
	if status_update.status_detail:
		status.status_detail = status_update.status_detail

	# we may change `updated_at` even if no data have changed, but thats intentional
	# other option would be to also have `worker_updated_at`, but thats harder to reason about
	status.updated_at = dt.datetime.utcnow()
	return status


def worker_register(url: str) -> WorkerId:
	worker_id = str(uuid.uuid4())
	worker_db[worker_id] = Worker(url=url)
	return WorkerId(worker_id=worker_id)

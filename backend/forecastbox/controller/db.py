"""
In-memory persistence for keeping track of workers (their hostname, status) and jobs (worker they run on, status).

Bottleneck for scalability -- adding more uvicorn workers would introduce inconsistency. We'd have to run this
as a standalone process, so that more workers wont add more dbs.
"""

import logging
import uuid
from dataclasses import dataclass, replace
from typing import Optional, Any
from forecastbox.api.common import TaskDAG, JobStatus, JobId, JobStatusEnum, WorkerId, JobStatusUpdate
from forecastbox.api.adapter import cascade2fiab
from forecastbox.db import KVStore, KVStorePyrsistent
from cascade.low.core import JobInstance, Schedule, Host
import forecastbox.scheduler as scheduler
import datetime as dt
from forecastbox.controller.comm import WorkerComm

logger = logging.getLogger(__name__)


@dataclass
class Job:
	status: JobStatus
	definition: Optional[TaskDAG]
	worker_id: Optional[WorkerId]


job_db: KVStore[Job] = KVStorePyrsistent[Job]()


@dataclass
class Worker:
	url: str
	last_seen: dt.datetime
	params: Host


worker_db: KVStore[Worker] = KVStorePyrsistent()


def job_status(job_id: JobId) -> Optional[JobStatus]:
	maybe_job = job_db.get(job_id.job_id)
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

	if missing := set(schedule.host_task_queues.keys()) - set(e[0] for e in worker_db.all()):
		status.status = JobStatusEnum.failed
		status.status_detail = f"unknown workers in schedule: {', '.join(missing)}"
		return status

	maybe_dag = cascade2fiab(job_instance, schedule)
	if maybe_dag.e:
		status.status = JobStatusEnum.failed
		status.status_detail = f"failure in conversion: {', '.join(maybe_dag.e)}"
		return status

	# TODO actually assign the job / tasks correctly
	job_db.update(job_id, Job(status, definition=maybe_dag.t, worker_id=None))
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
	job_db.update(job_id, Job(status=status, definition=definition, worker_id=None))

	return status


async def job_assign(job_id: str, worker_comm: WorkerComm) -> None:
	"""Actual communication with Worker to make it run the job in question"""
	# NOTE error handling here is tricky because we are in a background task.
	# So we can't "just raise" to end up with http exception in frontend
	if not worker_db:
		# TODO sleep-retry-or-fail
		logger.error("not enough workers")
		# TODO some counter/issue
		return
	job = job_db.get(job_id)
	if job is None:
		logger.error(f"unexpected internal state: {job_id} not found")
		# TODO some counter/issue
		return
	worker_id = list(e[0] for e in worker_db.all())[0]
	worker = worker_db.get(worker_id)
	if worker is None:
		logger.error("internal issue: worker {worker_id} not found")
		# TODO some counter/issue
		return
	task_dag = job.definition
	if not task_dag:
		# TODO some counter/issue
		if job.status.status != JobStatusEnum.failed:
			logger.error(f"job without task but not failed: {job_id}")
		return

	schedule = scheduler.linearize(task_dag)

	result = await worker_comm.call_submit(worker.url, job_id, schedule.model_dump())
	if not result:
		# TODO some counter/issue
		logger.error(f"failed to communicate with worker {worker.url} to assign job")
		return

	update = JobStatusUpdate(job_id=JobId(job_id=job_id), status=JobStatusEnum.assigned)
	rv = job_update(update, WorkerId(worker_id=worker_id))
	if not rv:
		logger.error(f"failed to update {job_id}")
		# TODO some counter/issue


def job_update(status_update: JobStatusUpdate, worker_id: Optional[WorkerId] = None) -> Optional[JobStatus]:
	job = job_db.get(status_update.job_id.job_id)
	if job is None:
		logger.error(f"unexpected internal state: {status_update.job_id} not found")
		return None
	status = job.status.model_copy()  # TODO pyrsistent inside, and then model_copy(updates=...)?

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
	ref_time = dt.datetime.utcnow()
	status.updated_at = ref_time

	replacer: dict[str, Any] = {"status": status}
	if worker_id is not None:
		replacer["worker_id"] = worker_id
		worker_heartbeat(worker_id.worker_id, ref_time)
	elif job.worker_id is not None:
		worker_heartbeat(job.worker_id.worker_id, ref_time)
	else:
		logger.warning(f"unclear worker assignment in job id {status_update.job_id}, skipping heartbeat")
	job_db.update(status_update.job_id.job_id, replace(job, **replacer))

	return status


def worker_heartbeat(worker_id: str, last_seen: dt.datetime) -> None:
	worker = worker_db.get(worker_id)
	if worker is None:
		logger.warning(f"attempted to updated non-existing worker {worker_id}, calmly carrying on")
		return
	if worker.last_seen >= last_seen:
		return
	worker_db.update(worker_id, replace(worker, last_seen=last_seen))


def worker_register(worker: Worker) -> WorkerId:
	worker_id = str(uuid.uuid4())
	worker_db.update(worker_id, worker)
	return WorkerId(worker_id=worker_id)

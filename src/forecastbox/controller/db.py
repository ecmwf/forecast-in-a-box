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
from forecastbox.api.common import JobDefinition, JobStatus, JobId, JobStatusEnum, WorkerId, JobStatusUpdate
import datetime as dt

logger = logging.getLogger(__name__)


@dataclass
class Job:
	status: JobStatus
	definition: JobDefinition
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


def job_submit(definition: JobDefinition) -> JobStatus:
	job_id = str(uuid.uuid4())[:23]  # we use job_id for opening shared memory, and https://trac.macports.org/ticket/64806
	status = JobStatus(
		job_id=JobId(job_id=job_id),
		created_at=dt.datetime.utcnow(),
		updated_at=dt.datetime.utcnow(),
		status=JobStatusEnum.submitted,
		result=None,
	)
	job_db[job_id] = Job(status=status, definition=definition, worker_id=None)

	return status


async def job_assign(job_id: str) -> None:
	# TODO the httpx part should not be in this module
	if not worker_db:
		# TODO sleep-retry-or-fail
		logger.error("not enough workers")
		return
	worker_id = list(worker_db.keys())[0]
	url = worker_db[worker_id].url
	definition = job_db[job_id].definition
	async with httpx.AsyncClient() as client:  # TODO pool the client
		try:
			response = await client.put(f"{url}/jobs/submit/{job_id}", json=definition.model_dump())
		except Exception:
			# TODO sleep-retry-or-fail
			logger.exception("failed to submit to worker")
			return
		if response.status_code != httpx.codes.OK:
			# TODO sleep-retry-or-fail
			logger.error(f"failed to submit to worker: {response}")
			return
	job_db[job_id].worker_id = WorkerId(worker_id=worker_id)
	update = JobStatusUpdate(job_id=JobId(job_id=job_id), update={"status": JobStatusEnum.assigned})
	job_update(update)


def job_update(job_status: JobStatusUpdate) -> JobStatus:
	new = job_db[job_status.job_id.job_id].status.model_copy(update=job_status.update)
	new.updated_at = dt.datetime.utcnow()
	job_db[job_status.job_id.job_id].status = new
	return new


def worker_register(url: str) -> WorkerId:
	worker_id = str(uuid.uuid4())
	worker_db[worker_id] = Worker(url=url)
	return WorkerId(worker_id=worker_id)

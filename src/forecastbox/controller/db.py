"""
In-memory persistence for keeping track of what jobs are submitted, and where they run

Not immediately scalable -- we'd need to launch this as a standalone process to separate from the uvicorn workers.
Or rewrite controller to rust
"""

import uuid
from dataclasses import dataclass
from typing import Optional
from forecastbox.api.controller import JobDefinition, JobStatus, JobId, JobStatusEnum
import datetime as dt


@dataclass
class Job:
	status: JobStatus
	definition: JobDefinition


the_db: dict[str, Job] = {}


def get_status(job_id: JobId) -> Optional[JobStatus]:
	maybe_job = the_db.get(job_id.job_id, None)
	if maybe_job is None:
		return None
	else:
		return maybe_job.status


def new_job(definition: JobDefinition) -> JobStatus:
	job_id = str(uuid.uuid4())
	status = JobStatus(
		job_id=JobId(job_id=job_id),
		created_at=dt.datetime.utcnow(),
		updated_at=dt.datetime.utcnow(),
		status=JobStatusEnum.submitted,
		result=None,
	)
	the_db[job_id] = Job(status=status, definition=definition)
	return status


def update_status(job_status: JobStatus) -> JobStatus:
	the_db[job_status.job_id.job_id].status = job_status
	return job_status

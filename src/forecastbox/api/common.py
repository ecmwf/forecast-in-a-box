"""
As served by the controller.server
"""

from pydantic import BaseModel, Field
from enum import Enum
import datetime as dt
from typing import Optional, Any
from typing_extensions import Self
import base64


# jobs
class JobFunctionEnum(str, Enum):
	"""Cascade Job Catalog"""

	hello_world = "hello_world"
	hello_torch = "hello_torch"
	hello_image = "hello_image"


class JobDefinition(BaseModel):
	function_name: JobFunctionEnum
	function_parameters: dict[str, str]


class JobId(BaseModel):
	job_id: str


class JobStatusEnum(str, Enum):
	submitted = "submitted"
	assigned = "assigned"
	running = "running"
	failed = "failed"
	finished = "finished"


class JobStatus(BaseModel):
	job_id: JobId
	created_at: dt.datetime
	updated_at: dt.datetime
	status: JobStatusEnum
	result: Optional[str] = Field(description="URL where the result can be streamed from")


class JobStatusUpdate(BaseModel):
	job_id: JobId
	update: dict[str, Any]

	# TODO validate update does not contain job_id, updated_at, created_at


# workers
class WorkerId(BaseModel):
	worker_id: str


class WorkerRegistration(BaseModel):
	url_base64: str

	@classmethod
	def from_raw(cls, url: str) -> Self:
		return cls(url_base64=base64.b64encode(url.encode()).decode())

	def url_raw(self) -> str:
		return base64.b64decode(self.url_base64.encode()).decode()

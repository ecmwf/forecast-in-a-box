"""
As served by the controller.server
"""

from pydantic import BaseModel, Field
from enum import Enum
import datetime as dt
from typing import Optional
from typing_extensions import Self
import base64


# jobs
class JobDefinition(BaseModel):
	function_name: str = Field(description="an item from the Cascade Job Catalog")
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

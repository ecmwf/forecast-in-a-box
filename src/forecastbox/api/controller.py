"""
As served by the controller.server
"""

from pydantic import BaseModel, Field
from enum import Enum
import datetime as dt
from typing import Any, Optional


class JobDefinition(BaseModel):
	function_name: str = Field(description="an item from the Cascade Job Catalog")
	function_parameters: dict[str, str]


class JobId(BaseModel):
	job_id: str


class JobStatusEnum(str, Enum):
	submitted = "submitted"
	running = "running"
	failed = "failed"
	finished = "finished"


class JobStatus(BaseModel):
	job_id: JobId
	created_at: dt.datetime
	updated_at: dt.datetime
	status: JobStatusEnum
	result: Optional[Any]


# TODO workers api

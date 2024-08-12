"""
As served by the controller.server
"""

from pydantic import BaseModel, Field
from enum import Enum
import datetime as dt
from typing import Optional, Any
from typing_extensions import Self
import base64


# controller: jobs
class JobFunctionEnum(str, Enum):
	"""Cascade Job Catalog"""

	hello_world = "hello_world"
	hello_torch = "hello_torch"
	hello_image = "hello_image"
	# hello_tasks = "hello_tasks"


class JobDefinition(BaseModel):
	function_name: JobFunctionEnum
	function_parameters: dict[str, str]

	# TODO validate function_name-function_parameters?


class JobId(BaseModel):
	job_id: str


class JobStatusEnum(str, Enum):
	# TODO this is on the whole job (ie, task dag) level. Granularize into task level
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


# controller: workers
class WorkerId(BaseModel):
	worker_id: str


class WorkerRegistration(BaseModel):
	url_base64: str

	@classmethod
	def from_raw(cls, url: str) -> Self:
		return cls(url_base64=base64.b64encode(url.encode()).decode())

	def url_raw(self) -> str:
		return base64.b64decode(self.url_base64.encode()).decode()


# worker: jobs and tasks
# a job is an atom submittable/retrievable by the user. It becomes DAG of tasks executed by workers


class DatasetId(BaseModel):
	dataset_id: str


class TaskFunctionEnum(str, Enum):
	hello_world = "hello_world"
	hello_torch = "hello_torch"
	hello_image = "hello_image"
	# hello_tasks_S1 = "hello_tasks_S1"
	# hello_tasks_S2 = "hello_tasks_S2"


class Task(BaseModel):
	static_params: dict[str, str]
	dataset_inputs: dict[str, DatasetId]
	function_name: TaskFunctionEnum
	output_name: Optional[DatasetId]


class TaskDAG(BaseModel):
	tasks: list[Task]  # assumed to be in topological (ie, computable) order -- eg, schedule
	output_id: Optional[DatasetId]
	# TODO validate consistency: outputs unique, subset of set(output_name), topological
	# TODO add in free(dataset_id) events into the tasks
	# TODO add some mechanism for freeing the output_name(dataset_id) as well

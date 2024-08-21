"""
As served by the controller.server
"""

from pydantic import BaseModel, Field
from enum import Enum
import datetime as dt
from typing import Optional
from typing_extensions import Self
import base64


# controller: jobs
class JobFunctionEnum(str, Enum):
	"""Cascade Job Catalog"""

	hello_world = "hello_world"
	hello_torch = "hello_torch"
	hello_image = "hello_image"
	hello_tasks = "hello_tasks"
	hello_earth = "hello_earth"
	hello_aifsl = "hello_aifsl"

	temperature_nbeats = "temperature_nbeats"


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
	stages: dict[str, JobStatusEnum] = Field(default_factory=dict)
	result: Optional[str] = Field(description="URL where the result can be streamed from")


class JobStatusUpdate(BaseModel):
	job_id: JobId
	status: JobStatusEnum
	task_name: Optional[str] = None
	result: Optional[str] = None


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


# NOTE eventually put to docs:
# 1. user selects from TaskDefinition list
# 2. webui generates form from the TaskDefinition
# 3. user fills it, becomes TaskDag
# 4. worker executes the Tasks in the TaskDag in a sequence (or as prescribed by the execution plan)


class TaskDefinition(BaseModel):
	"""Used for generating input forms and parameter validation"""

	entrypoint: str = Field(description="python_module.function_name")
	param_names: list[str]  # TODO uniq validation
	# TODO param types
	# TODO output type
	# TODO deal with static vs dataset params
	# TODO environment


# TODO TaskDefinitionDAG?


class Task(BaseModel):
	"""Represents an atomic computation done in a single process.
	Created from user's input (validated via TaskDefinition)"""

	name: str  # name of the task within the DAG
	static_params: dict[str, str]
	dataset_inputs: dict[str, DatasetId]
	entrypoint: str = Field(description="python_module.submodules.function_name")
	output_name: Optional[DatasetId]


class TaskDAG(BaseModel):
	"""Represents a complete (distributed) computation, consisting of atomic Tasks.
	Needs no further user input, finishes with the output that the user specified."""

	tasks: list[Task]  # assumed to be in topological (ie, computable) order -- eg, schedule
	output_id: Optional[DatasetId]
	# TODO validate consistency: outputs unique, subset of set(output_name), topological, task.name unique
	# TODO add in free(dataset_id) events into the tasks
	# TODO add some mechanism for freeing the output_name(dataset_id) as well

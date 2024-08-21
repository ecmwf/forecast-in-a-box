"""
Pydantic models for interchanges between ui, controller and worker
"""

# TODO split into submodules

from pydantic import BaseModel, Field
from enum import Enum
import datetime as dt
from typing import Optional
from typing_extensions import Self
import base64

# NOTE eventually put to docs:
# 1. user selects from JobType list
# 2. webui generates form from the JobTemplate
# 3. user fills it so that JobTemplate becomes TaskDag
# 4. controller converts the schedule-agnostic TaskDag into a (linear) execution plan
# 4. worker executes the Tasks in the execution plan


class JobTypeEnum(str, Enum):
	"""Job Catalog"""

	hello_world = "hello_world"
	hello_torch = "hello_torch"
	hello_image = "hello_image"
	hello_tasks = "hello_tasks"
	hello_earth = "hello_earth"
	hello_aifsl = "hello_aifsl"

	temperature_nbeats = "temperature_nbeats"


class DatasetId(BaseModel):
	dataset_id: str


class TaskParameter(BaseModel):
	# NOTE this would ideally be a pydantic class
	# that would however introduce a requirement for jobs not to be text but bytecode
	# but we may want to do it anyway because we'd need custom validations, esp for the rich classes etc
	# Or we could introduce custom subtypes like lat, lon, latLonBox, marsParam, ...
	name: str
	clazz: str  # must be eval-uable... primitive type or collection, nested eval/generics not supported. Used to de-serialize
	default: str = ""  # always string because we put it to html form... will be deserd via type_name


class TaskDefinition(BaseModel):
	"""Used for generating input forms and parameter validation"""

	entrypoint: str = Field(description="python_module.function_name")
	user_params: list[TaskParameter]  # TODO uniq validation
	output_class: str  # not eval'd, can be anything
	dynamic_param_classes: list[tuple[str, str]] = Field(default_factory=list)  # TODO uniq validation
	# TODO environment


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

	job_type: JobTypeEnum
	tasks: list[Task]  # assumed to be in topological (ie, computable) order -- eg, schedule
	output_id: Optional[DatasetId]
	# TODO validate consistency: outputs unique, subset of set(output_name), topological, task.name unique
	# TODO add in free(dataset_id) events into the tasks
	# TODO add some mechanism for freeing the output_name(dataset_id) as well


class JobTemplate(BaseModel):
	job_type: JobTypeEnum
	tasks: list[tuple[str, TaskDefinition]]
	dynamic_task_inputs: dict[str, list[tuple[str, str]]]  # param_name: data_source
	final_output_at: str
	# TODO validate consistency (somehow shared with TaskDAG?)


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

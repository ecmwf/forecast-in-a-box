"""
Pydantic models for interchanges between ui, controller and worker
"""

# TODO split into submodules

from pydantic import BaseModel, Field
from enum import Enum
import datetime as dt
from typing import Optional, Any
from typing_extensions import Self
import base64


class JobTemplateExample(str, Enum):
	"""Job Catalog"""

	# NOTE this will get eventually replaced by external import/lookup system
	# See plugin/lookup.py

	hello_world = "hello_world"
	hello_torch = "hello_torch"
	hello_image = "hello_image"
	hello_tasks = "hello_tasks"
	hello_earth = "hello_earth"
	hello_aifsl = "hello_aifsl"
	temperature_nbeats = "temperature_nbeats"


class RegisteredTask(str, Enum):
	"""Job Catalog"""

	# NOTE this will get eventually replaced by external import/lookup system
	# See plugin/lookup.py

	hello_world = "hello_world"
	create_numpy_array = "create_numpy_array"
	display_numpy_array = "display_numpy_array"
	hello_torch = "hello_torch"
	hello_image = "hello_image"
	mars_oper_sfc_box = "mars_oper_sfc_box"
	mars_enfo_range_temp = "mars_enfo_range_temp"
	aifs_fetch_and_predict = "aifs_fetch_and_predict"
	plot_single_grib = "plot_single_grib"
	nbeats_predict = "nbeats_predict"


class DatasetId(BaseModel):
	dataset_id: str


class TaskParameter(BaseModel):
	# NOTE this would ideally be a pydantic class
	# that would however introduce a requirement for jobs not to be text but bytecode
	# but we may want to do it anyway because we'd need custom validations, esp for the rich classes etc
	# Or we could introduce custom subtypes like lat, lon, latLonBox, marsParam, ...
	clazz: str  # see api.type_system on whats supported
	default: str = ""  # always string because we put it to html form... will be deserd via type_name


class TaskEnvironment(BaseModel):
	packages: list[str] = Field(description="module names + optionally versions, in the pip format", default_factory=list)

	def __add__(self, other: Self) -> Self:
		# consider using pyrsistent here
		return self.__class__(packages=self.packages + other.packages)


class TaskDefinition(BaseModel):
	"""Used for generating input forms and parameter validation"""

	entrypoint: str = Field(description="python_module.function_name")
	user_params: dict[str, TaskParameter]
	output_class: str  # not eval'd, can be anything
	dynamic_param_classes: dict[str, str] = Field(default_factory=dict)
	environment: TaskEnvironment = Field(default_factory=TaskEnvironment)


class Task(BaseModel):
	"""Represents an atomic computation done in a single process.
	Created from user's input (validated via TaskDefinition)"""

	name: str  # name of the task within the DAG
	static_params: dict[str, Any]  # name, value
	dataset_inputs: dict[str, DatasetId]
	entrypoint: str = Field(description="python_module.submodules.function_name")
	output_name: Optional[DatasetId]  # TODO maybe replace with a method yielding just name
	environment: TaskEnvironment


class TaskDAG(BaseModel):
	"""Represents a complete (distributed) computation, consisting of atomic Tasks.
	Needs no further user input, finishes with the output that the user specified."""

	tasks: list[Task]  # assumed to be in topological (ie, computable) order -- eg, schedule
	output_id: Optional[DatasetId]
	# TODO add in free(dataset_id) events into the tasks
	# TODO add some mechanism for freeing the output_name(dataset_id) as well


class JobTemplate(BaseModel):
	tasks: list[tuple[str, TaskDefinition]]  # NOTE already assumed to be in (some) topological order
	dynamic_task_inputs: dict[str, dict[str, str]]  # task_name: {param_name: data_source}
	final_output_at: str


class JobId(BaseModel):
	job_id: str


class JobStatusEnum(str, Enum):
	submitted = "submitted"
	assigned = "assigned"
	preparing = "preparing"
	running = "running"
	failed = "failed"
	finished = "finished"

	@classmethod
	def valid_transition(cls, before: Optional[Self], after: Self) -> bool:
		# maybe mixin int (for ordinality), but be careful about pydantic serde
		lookup = list(cls)  # maybe cache
		return before is None or lookup.index(before) < lookup.index(after)


class JobStatus(BaseModel):
	job_id: JobId
	created_at: dt.datetime
	updated_at: dt.datetime
	status: JobStatusEnum
	status_detail: str
	stages: dict[str, JobStatusEnum] = Field(default_factory=dict)
	result: Optional[str] = Field(description="URL where the result can be streamed from")


class JobStatusUpdate(BaseModel):
	job_id: JobId
	status: JobStatusEnum
	task_name: Optional[str] = None
	result: Optional[str] = None
	status_detail: Optional[str] = None


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

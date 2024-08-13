"""
Converts high level "job name" input of the user into a sequence of individual functions to be run on the worker
"""

from forecastbox.api.common import JobDefinition, TaskDAG, Task, TaskFunctionEnum, JobFunctionEnum, DatasetId
from forecastbox.utils import assert_never


def build(job_definition: JobDefinition) -> TaskDAG:
	tasks: list[Task]
	match job_definition.function_name:
		case JobFunctionEnum.hello_world:
			tasks = [
				Task(
					static_params=job_definition.function_parameters,
					dataset_inputs={},
					function_name=TaskFunctionEnum.hello_world,
					output_name=DatasetId(dataset_id="output"),
				)
			]
		case JobFunctionEnum.hello_torch:
			tasks = [
				Task(
					static_params=job_definition.function_parameters,
					dataset_inputs={},
					function_name=TaskFunctionEnum.hello_torch,
					output_name=DatasetId(dataset_id="output"),
				)
			]
		case JobFunctionEnum.hello_image:
			tasks = [
				Task(
					static_params=job_definition.function_parameters,
					dataset_inputs={},
					function_name=TaskFunctionEnum.hello_image,
					output_name=DatasetId(dataset_id="output"),
				)
			]
		case JobFunctionEnum.hello_tasks:
			tasks = [
				Task(
					static_params=job_definition.function_parameters,
					dataset_inputs={},
					function_name=TaskFunctionEnum.hello_tasks_step1,
					output_name=DatasetId(dataset_id="intermediate"),
				),
				Task(
					static_params={},
					dataset_inputs={"intermediate": DatasetId(dataset_id="intermediate")},
					function_name=TaskFunctionEnum.hello_tasks_step2,
					output_name=DatasetId(dataset_id="output"),
				),
			]
		case JobFunctionEnum.hello_earth:
			tasks = [
				Task(
					static_params=job_definition.function_parameters,
					dataset_inputs={},
					function_name=TaskFunctionEnum.earthkit_querymars,
					output_name=DatasetId(dataset_id="output"),
				)
			]
		case s:
			assert_never(s)

	return TaskDAG(tasks=tasks, output_id=DatasetId(dataset_id="output"))

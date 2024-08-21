"""
Converts high level input of the user into an execution plan (sequence of individual functions) to be run on the worker(s)
"""

from forecastbox.api.common import JobDefinition, TaskDAG, Task, JobFunctionEnum, DatasetId
from forecastbox.utils import assert_never


def build(job_definition: JobDefinition) -> TaskDAG:
	tasks: list[Task]
	match job_definition.function_name:
		case JobFunctionEnum.hello_world:
			tasks = [
				Task(
					name="hello_world",
					static_params=job_definition.function_parameters,
					dataset_inputs={},
					entrypoint="forecastbox.jobs.hello_world.entrypoint",
					output_name=DatasetId(dataset_id="output"),
				)
			]
		case JobFunctionEnum.hello_torch:
			tasks = [
				Task(
					name="hello_torch",
					static_params=job_definition.function_parameters,
					dataset_inputs={},
					entrypoint="forecastbox.jobs.hello_torch.entrypoint",
					output_name=DatasetId(dataset_id="output"),
				)
			]
		case JobFunctionEnum.hello_image:
			tasks = [
				Task(
					name="hello_image",
					static_params=job_definition.function_parameters,
					dataset_inputs={},
					entrypoint="forecastbox.jobs.hello_image.entrypoint",
					output_name=DatasetId(dataset_id="output"),
				)
			]
		case JobFunctionEnum.hello_tasks:
			tasks = [
				Task(
					name="create_data",
					static_params=job_definition.function_parameters,
					dataset_inputs={},
					entrypoint="forecastbox.jobs.hello_tasks.entrypoint_step1",
					output_name=DatasetId(dataset_id="intermediate"),
				),
				Task(
					name="display_data",
					static_params={},
					dataset_inputs={"intermediate": DatasetId(dataset_id="intermediate")},
					entrypoint="forecastbox.jobs.hello_tasks.entrypoint_step2",
					output_name=DatasetId(dataset_id="output"),
				),
			]
		case JobFunctionEnum.hello_earth:
			tasks = [
				Task(
					name="hello_earth",
					static_params=job_definition.function_parameters,
					dataset_inputs={},
					entrypoint="forecastbox.jobs.hello_earth.entrypoint_marsquery",
					output_name=DatasetId(dataset_id="output"),
				)
			]
		case JobFunctionEnum.temperature_nbeats:
			tasks = [
				Task(
					name="get_data",
					static_params=job_definition.function_parameters,
					dataset_inputs={},
					entrypoint="forecastbox.jobs.temperature_nbeats.get_data",
					output_name=DatasetId(dataset_id="data"),
				),
				Task(
					name="predict",
					static_params={},
					dataset_inputs={"data": DatasetId(dataset_id="data")},
					entrypoint="forecastbox.jobs.temperature_nbeats.predict",
					output_name=DatasetId(dataset_id="output"),
				),
			]
		case JobFunctionEnum.hello_aifsl:
			tasks = [
				Task(
					name="fetch_and_predict",
					static_params=job_definition.function_parameters,
					dataset_inputs={},
					entrypoint="forecastbox.jobs.hello_aifs.entrypoint_forecast",
					output_name=DatasetId(dataset_id="data"),
				),
				Task(
					name="plot",
					static_params=job_definition.function_parameters,
					dataset_inputs={"data": DatasetId(dataset_id="data")},
					entrypoint="forecastbox.jobs.hello_aifs.entrypoint_plot",
					output_name=DatasetId(dataset_id="output"),
				),
			]
		case s:
			assert_never(s)

	return TaskDAG(tasks=tasks, output_id=DatasetId(dataset_id="output"))

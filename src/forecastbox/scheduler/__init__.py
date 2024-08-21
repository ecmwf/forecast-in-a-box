"""
Converts high level input of the user into an execution plan (sequence of individual functions) to be run on the worker(s)
"""

from forecastbox.api.common import JobTemplate, TaskDefinition, TaskDAG, Task, JobTypeEnum, DatasetId
from forecastbox.utils import assert_never
from collections import defaultdict


def prepare(job_type: JobTypeEnum) -> JobTemplate:
	"""Looks up a job template -- for retrieving the list of user params / filling it with params
	to obtain a job definition"""
	# NOTE this will eventually be "plugin"-based
	tasks: list[tuple[str, TaskDefinition]]
	match job_type:
		case JobTypeEnum.hello_world:
			tasks = [
				(
					"hello_world",
					TaskDefinition(
						param_names=["param1", "param2"],
						entrypoint="forecastbox.jobs.hello_world.entrypoint",
					),
				)
			]
			dynamic_task_inputs = {}
			final_output_at = "hello_world"
		case JobTypeEnum.hello_tasks:
			tasks = [
				(
					"create_data",
					TaskDefinition(
						param_names=["adhocParam1", "adhocParam2"],
						entrypoint="forecastbox.jobs.hello_tasks.entrypoint_step1",
					),
				),
				(
					"display_data",
					TaskDefinition(
						param_names=["adhocParam3"],
						entrypoint="forecastbox.jobs.hello_tasks.entrypoint_step2",
					),
				),
			]
			final_output_at = "display_data"
			dynamic_task_inputs = {"display_data": [("intertaskParam", "create_data")]}
		case JobTypeEnum.hello_torch:
			tasks = [
				(
					"hello_torch",
					TaskDefinition(
						param_names=["tensor_0", "tensor_1"],
						entrypoint="forecastbox.jobs.hello_torch.entrypoint",
					),
				)
			]
			final_output_at = "hello_torch"
			dynamic_task_inputs = {}
		case JobTypeEnum.hello_image:
			tasks = [
				(
					"hello_image",
					TaskDefinition(
						param_names=["red", "green", "blue"],
						entrypoint="forecastbox.jobs.hello_image.entrypoint",
					),
				)
			]
			final_output_at = "hello_image"
			dynamic_task_inputs = {}
		case JobTypeEnum.hello_earth:
			tasks = [
				(
					"hello_earth",
					TaskDefinition(
						param_names=["days_ago", "midnight_or_noon"],
						entrypoint="forecastbox.jobs.hello_earth.entrypoint_marsquery",
					),
				)
			]
			final_output_at = "hello_earth"
			dynamic_task_inputs = {}
		case JobTypeEnum.temperature_nbeats:
			tasks = [
				(
					"get_data",
					TaskDefinition(
						param_names=["lat", "lon"],
						entrypoint="forecastbox.jobs.temperature_nbeats.get_data",
					),
				),
				(
					"predict",
					TaskDefinition(
						param_names=[],
						entrypoint="forecastbox.jobs.temperature_nbeats.predict",
					),
				),
			]
			final_output_at = "predict"
			dynamic_task_inputs = {"predict": [("input_df", "get_data")]}
		case JobTypeEnum.hello_aifsl:
			tasks = [
				(
					"fetch_and_predict",
					TaskDefinition(
						param_names=["predicted_param", "target_step"],
						# eg 2t
						# in hours... should be divisible by 6, presumably <= 240
						entrypoint="forecastbox.jobs.hello_aifs.entrypoint_forecast",
					),
				),
				(
					"plot",
					TaskDefinition(
						param_names=[],
						entrypoint="forecastbox.jobs.hello_aifs.entrypoint_plot",
					),
				),
			]
			final_output_at = "plot"
			dynamic_task_inputs = {"plot": [("input_grib", "fetch_and_predict")]}
		case s:
			assert_never(s)
	return JobTemplate(job_type=job_type, tasks=tasks, dynamic_task_inputs=dynamic_task_inputs, final_output_at=final_output_at)


def linearize(job_definition: TaskDAG) -> TaskDAG:
	"""A placeholder method for converting a schedule-agnostic dag into an execution plan"""
	return job_definition


def build(job_template: JobTemplate, params: dict[str, str]) -> TaskDAG:
	params_per_task: dict[str, dict[str, str]] = defaultdict(dict)
	for k, v in params.items():
		task, param = k.split(".", 1)
		params_per_task[task][param] = v
	tasks = [
		Task(
			name=task_name,
			static_params=params_per_task[task_name],
			dataset_inputs={e[0]: DatasetId(dataset_id=e[1]) for e in job_template.dynamic_task_inputs.get(task_name, [])},
			entrypoint=task_definition.entrypoint,
			output_name=DatasetId(dataset_id=task_name),
		)
		for task_name, task_definition in job_template.tasks
	]
	return TaskDAG(tasks=tasks, output_id=DatasetId(dataset_id=job_template.final_output_at), job_type=job_template.job_type)

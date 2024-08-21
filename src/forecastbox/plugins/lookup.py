"""
Utils for converting user inputs into schedulable job template

Currently all is hardcoded, but will be replaced by reading from external, either as code or as config
"""

from forecastbox.api.common import JobTemplate, TaskDefinition, JobTypeEnum, TaskParameter
import forecastbox.api.validation as validation
from forecastbox.utils import assert_never, Either


def prepare(job_type: JobTypeEnum) -> Either[JobTemplate, str]:
	"""Looks up a job template -- for retrieving the list of user params / filling it with params
	to obtain a job definition"""
	# TODO wrap in try catch
	tasks: list[tuple[str, TaskDefinition]]
	match job_type:
		case JobTypeEnum.hello_world:
			tasks = [
				(
					"hello_world",
					TaskDefinition(
						user_params=[
							TaskParameter(name="param1", clazz="str"),
							TaskParameter(name="param2", clazz="str"),
						],
						entrypoint="forecastbox.external.hello_world.entrypoint",
						output_class="str",
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
						user_params=[
							TaskParameter(name="adhocParam1", clazz="int", default="0"),
							TaskParameter(name="adhocParam2", clazz="int", default="1"),
						],
						entrypoint="forecastbox.external.hello_tasks.entrypoint_step1",
						output_class="ndarray",
					),
				),
				(
					"display_data",
					TaskDefinition(
						user_params=[
							TaskParameter(name="adhocParam3", clazz="str", default="hello"),
						],
						entrypoint="forecastbox.external.hello_tasks.entrypoint_step2",
						output_class="str",
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
						user_params=[
							TaskParameter(name="tensor_0", clazz="int", default="42"),
							TaskParameter(name="tensor_1", clazz="int", default="128"),
						],
						entrypoint="forecastbox.external.hello_torch.entrypoint",
						output_class="str",
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
						user_params=[
							TaskParameter(name="red", clazz="int"),
							TaskParameter(name="green", clazz="int"),
							TaskParameter(name="blue", clazz="int"),
						],
						entrypoint="forecastbox.external.hello_image.entrypoint",
						output_class="png",
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
						user_params=[
							TaskParameter(name="days_ago", clazz="int"),
							TaskParameter(name="midnight_or_noon", clazz="int"),
						],
						entrypoint="forecastbox.external.hello_earth.entrypoint_marsquery",
						output_class="png",  # I guess
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
						user_params=[
							TaskParameter(name="lat", clazz="int"),
							TaskParameter(name="lon", clazz="int"),
						],
						entrypoint="forecastbox.external.temperature_nbeats.get_data",
						output_class="ndarray",
					),
				),
				(
					"predict",
					TaskDefinition(
						user_params=[],
						entrypoint="forecastbox.external.temperature_nbeats.predict",
						output_class="str",
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
						user_params=[
							TaskParameter(name="predicted_param", clazz="str"),  # 2t
							TaskParameter(name="target_step", clazz="int"),  # hours, div by 6
						],
						entrypoint="forecastbox.external.hello_aifs.entrypoint_forecast",
						output_class="grib",
					),
				),
				(
					"plot",
					TaskDefinition(
						user_params=[],
						entrypoint="forecastbox.external.hello_aifs.entrypoint_plot",
						output_class="png",  # I guess
					),
				),
			]
			final_output_at = "plot"
			dynamic_task_inputs = {"plot": [("input_grib", "fetch_and_predict")]}
		case s:
			assert_never(s)
	rv = JobTemplate(job_type=job_type, tasks=tasks, dynamic_task_inputs=dynamic_task_inputs, final_output_at=final_output_at)
	return validation.of_template(rv)

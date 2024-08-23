"""
Utils for converting user inputs into schedulable job template

Currently all is hardcoded, but will be replaced by reading from external, either as code or as config
"""

from forecastbox.api.common import JobTemplate, TaskDefinition, JobTypeEnum, TaskParameter, TaskEnvironment
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
						user_params={
							"param1": TaskParameter(clazz="str"),
							"param2": TaskParameter(clazz="str"),
						},
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
						user_params={
							"adhocParam1": TaskParameter(clazz="int", default="0"),
							"adhocParam2": TaskParameter(clazz="int", default="1"),
						},
						entrypoint="forecastbox.external.hello_tasks.entrypoint_step1",
						output_class="ndarray",
						environment=TaskEnvironment(packages=["numpy"]),
					),
				),
				(
					"display_data",
					TaskDefinition(
						user_params={
							"adhocParam3": TaskParameter(clazz="str", default="hello"),
						},
						entrypoint="forecastbox.external.hello_tasks.entrypoint_step2",
						output_class="str",
						dynamic_param_classes={"intertaskParam": "ndarray"},
						environment=TaskEnvironment(packages=["numpy"]),
					),
				),
			]
			final_output_at = "display_data"
			dynamic_task_inputs = {"display_data": {"intertaskParam": "create_data"}}
		case JobTypeEnum.hello_torch:
			tasks = [
				(
					"hello_torch",
					TaskDefinition(
						user_params={
							"tensor_0": TaskParameter(clazz="int", default="42"),
							"tensor_1": TaskParameter(clazz="int", default="128"),
						},
						entrypoint="forecastbox.external.hello_torch.entrypoint",
						output_class="str",
						environment=TaskEnvironment(packages=["torch"]),
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
						user_params={
							"red": TaskParameter(clazz="int"),
							"green": TaskParameter(clazz="int"),
							"blue": TaskParameter(clazz="int"),
						},
						entrypoint="forecastbox.external.hello_image.entrypoint",
						output_class="png",
						environment=TaskEnvironment(packages=["Pillow"]),
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
						user_params={
							"days_ago": TaskParameter(clazz="int"),
							"midnight_or_noon": TaskParameter(clazz="int"),
						},
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
						user_params={
							"lat": TaskParameter(clazz="int"),
							"lon": TaskParameter(clazz="int"),
						},
						entrypoint="forecastbox.external.temperature_nbeats.get_data",
						output_class="ndarray",
					),
				),
				(
					"predict",
					TaskDefinition(
						user_params={},
						entrypoint="forecastbox.external.temperature_nbeats.predict",
						output_class="str",
						dynamic_param_classes={"input_df": "ndarray"},
					),
				),
			]
			final_output_at = "predict"
			dynamic_task_inputs = {"predict": {"input_df": "get_data"}}
		case JobTypeEnum.hello_aifsl:
			tasks = [
				(
					"fetch_and_predict",
					TaskDefinition(
						user_params={
							"predicted_param": TaskParameter(clazz="str"),  # 2t
							"target_step": TaskParameter(clazz="int"),  # hours, div by 6
						},
						entrypoint="forecastbox.external.hello_aifs.entrypoint_forecast",
						output_class="grib",
					),
				),
				(
					"plot",
					TaskDefinition(
						user_params={},
						entrypoint="forecastbox.external.hello_aifs.entrypoint_plot",
						output_class="png",  # I guess
						dynamic_param_classes={"input_grib": "grib"},
					),
				),
			]
			final_output_at = "plot"
			dynamic_task_inputs = {"plot": {"input_grib": "fetch_and_predict"}}
		case s:
			assert_never(s)
	rv = JobTemplate(job_type=job_type, tasks=tasks, dynamic_task_inputs=dynamic_task_inputs, final_output_at=final_output_at)
	return validation.of_template(rv)

"""
Utils for converting user inputs into schedulable job template

Currently all is hardcoded, but will be replaced by reading from external, either as code or as config
"""

from forecastbox.api.common import RegisteredTask, JobTemplate, TaskDefinition, JobTemplateExample, TaskParameter, TaskEnvironment
import forecastbox.api.validation as validation
from forecastbox.utils import assert_never, Either


def get_task(task: RegisteredTask) -> TaskDefinition:
	match task:
		case RegisteredTask.hello_world:
			return TaskDefinition(
				user_params={
					"param1": TaskParameter(clazz="str"),
					"param2": TaskParameter(clazz="str"),
				},
				entrypoint="forecastbox.external.hello_world.entrypoint",
				output_class="str",
			)
		case RegisteredTask.create_numpy_array:
			return TaskDefinition(
				user_params={
					"adhocParam1": TaskParameter(clazz="int", default="0"),
					"adhocParam2": TaskParameter(clazz="int", default="1"),
				},
				entrypoint="forecastbox.external.hello_tasks.entrypoint_step1",
				output_class="ndarray",
				environment=TaskEnvironment(packages=["numpy"]),
			)
		case RegisteredTask.display_numpy_array:
			return TaskDefinition(
				user_params={
					"adhocParam3": TaskParameter(clazz="str", default="hello"),
				},
				entrypoint="forecastbox.external.hello_tasks.entrypoint_step2",
				output_class="str",
				dynamic_param_classes={"intertaskParam": "ndarray"},
				environment=TaskEnvironment(packages=["numpy"]),
			)
		case RegisteredTask.hello_torch:
			return TaskDefinition(
				user_params={
					"tensor_0": TaskParameter(clazz="int", default="42"),
					"tensor_1": TaskParameter(clazz="int", default="128"),
				},
				entrypoint="forecastbox.external.hello_torch.entrypoint",
				output_class="str",
				environment=TaskEnvironment(packages=["torch"]),
			)
		case RegisteredTask.hello_image:
			return TaskDefinition(
				user_params={
					"red": TaskParameter(clazz="int"),
					"green": TaskParameter(clazz="int"),
					"blue": TaskParameter(clazz="int"),
				},
				entrypoint="forecastbox.external.hello_image.entrypoint",
				output_class="png",
				environment=TaskEnvironment(packages=["Pillow"]),
			)
		case RegisteredTask.query_mars_grib_plot:
			return TaskDefinition(
				user_params={
					"days_ago": TaskParameter(clazz="int"),
					"midnight_or_noon": TaskParameter(clazz="int"),
					"box_center_lat": TaskParameter(clazz="latitude"),
					"box_center_lon": TaskParameter(clazz="longitude"),
					"param": TaskParameter(clazz="marsParam"),
				},
				entrypoint="forecastbox.external.hello_earth.entrypoint_marsquery",
				output_class="png",  # I guess
				environment=TaskEnvironment(packages=["numpy<2.0.0", "ecmwf-api-client", "earthkit-data", "earthkit-plots"]),
			)
		case RegisteredTask.aifs_fetch_and_predict:
			return TaskDefinition(
				user_params={
					"predicted_param": TaskParameter(clazz="marsParam"),
					"target_step": TaskParameter(clazz="int"),  # hours, div by 6
				},
				entrypoint="forecastbox.external.hello_aifs.entrypoint_forecast",
				output_class="grib",
				environment=TaskEnvironment(
					packages=[
						"numpy<2.0.0",
						"torch",
						"climetlab",
						"anemoi-inference",
					]
				),  # NOTE this doesnt work yet because the aifs mono aint pypi accessible; venv needed
			)
		case RegisteredTask.plot_single_grib:
			return TaskDefinition(
				user_params={
					"box_center_lat": TaskParameter(clazz="latitude"),
					"box_center_lon": TaskParameter(clazz="longitude"),
				},
				entrypoint="forecastbox.external.plotting.plot_single_grib",
				output_class="png",  # I guess
				dynamic_param_classes={"input_grib": "grib"},
				environment=TaskEnvironment(packages=["numpy<2.0.0", "earthkit-data", "earthkit-plots"]),
			)
		case RegisteredTask.query_mars_numpy:
			return TaskDefinition(
				user_params={
					"lat": TaskParameter(clazz="latitude"),
					"lon": TaskParameter(clazz="longitude"),
				},
				entrypoint="forecastbox.external.temperature_nbeats.get_data",
				output_class="ndarray",
			)
		case RegisteredTask.nbeats_predict:
			return TaskDefinition(
				user_params={},
				entrypoint="forecastbox.external.temperature_nbeats.predict",
				output_class="str",
				dynamic_param_classes={"input_df": "ndarray"},
			)
		case s:
			assert_never(s)


def resolve_builder_linear(task_names: list[RegisteredTask]) -> Either[JobTemplate, str]:
	# TODO wrap in try catch, extend the validation
	tasks: list[tuple[str, TaskDefinition]] = []
	dynamic_task_inputs = {}
	for i, e in enumerate(task_names):
		task = get_task(e)
		dyn_params = len(task.dynamic_param_classes)
		if dyn_params == 1:
			dynamic_task_inputs[e.value] = {list(task.dynamic_param_classes.keys())[0]: tasks[i - 1][0]}
		elif dyn_params > 1:
			# TODO append to val
			raise ValueError(f"task {e.value} at position {i} in the sequence needs >1 dyn params, unsupported")
		tasks.append(
			(
				e.value,
				task,
			)
		)
	final_output_at = task_names[-1].value
	rv = JobTemplate(tasks=tasks, dynamic_task_inputs=dynamic_task_inputs, final_output_at=final_output_at)
	return validation.of_template(rv)


def resolve_example(job_type: JobTemplateExample) -> Either[JobTemplate, str]:
	"""Looks up a job template -- for retrieving the list of user params / filling it with params
	to obtain a job definition"""
	match job_type:
		case JobTemplateExample.hello_world:
			return resolve_builder_linear([RegisteredTask.hello_world])
		case JobTemplateExample.hello_tasks:
			return resolve_builder_linear([RegisteredTask.create_numpy_array, RegisteredTask.display_numpy_array])
		case JobTemplateExample.hello_torch:
			return resolve_builder_linear([RegisteredTask.hello_torch])
		case JobTemplateExample.hello_image:
			return resolve_builder_linear([RegisteredTask.hello_image])
		case JobTemplateExample.hello_earth:
			return resolve_builder_linear([RegisteredTask.query_mars_grib_plot])
		case JobTemplateExample.temperature_nbeats:
			return resolve_builder_linear([RegisteredTask.query_mars_numpy, RegisteredTask.nbeats_predict])
		case JobTemplateExample.hello_aifsl:
			return resolve_builder_linear([RegisteredTask.aifs_fetch_and_predict, RegisteredTask.plot_single_grib])
		case s:
			assert_never(s)

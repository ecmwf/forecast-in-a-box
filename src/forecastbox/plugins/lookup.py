"""
Utils for converting user inputs into schedulable job template

Currently most is hardcoded, but will be replaced by reading from external, either as code or as config
"""

import logging
from forecastbox.api.common import RegisteredTask, TaskDAGBuilder, TaskDefinition, TaskParameter, TaskEnvironment
import forecastbox.api.validation as validation
from forecastbox.utils import assert_never, Either

logger = logging.getLogger(__name__)


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
		case RegisteredTask.mars_oper_sfc_box:
			return TaskDefinition(
				user_params={
					"days_ago": TaskParameter(clazz="int"),
					"step": TaskParameter(clazz="int"),
					"box_center_lat": TaskParameter(clazz="latitude"),
					"box_center_lon": TaskParameter(clazz="longitude"),
					"params": TaskParameter(clazz="marsParamList"),
				},
				entrypoint="forecastbox.external.data_sources.oper_sfc_box_query",
				output_class="grib",
				environment=TaskEnvironment(packages=["numpy<2.0.0", "ecmwf-api-client", "earthkit-data", "earthkit-plots"]),
			)
		case RegisteredTask.aifs_fetch_and_predict:
			return TaskDefinition(
				user_params={
					"predicted_params": TaskParameter(clazz="aifsOutputParamList", default="2t, q"),
					"target_step": TaskParameter(clazz="six_hours"),
					"start_date": TaskParameter(clazz="datetime"),
					"model_id": TaskParameter(clazz="enum[aifs-small]"),
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
					"box_lat1": TaskParameter(clazz="latitude"),
					"box_lat2": TaskParameter(clazz="latitude"),
					"box_lon1": TaskParameter(clazz="longitude"),
					"box_lon2": TaskParameter(clazz="longitude"),
					"grib_idx": TaskParameter(clazz="int", default="0"),
					"grib_param": TaskParameter(clazz="Optional[marsParam]", default=""),
				},
				entrypoint="forecastbox.external.data_sinks.plot_single_grib",
				output_class="png",  # I guess
				dynamic_param_classes={"input_grib": "grib"},
				environment=TaskEnvironment(packages=["numpy<2.0.0", "earthkit-data", "earthkit-plots"]),
			)
		case RegisteredTask.grib_to_file:
			return TaskDefinition(
				user_params={
					"path": TaskParameter(clazz="str"),
				},
				entrypoint="forecastbox.external.data_sinks.grib_to_file",
				output_class="str",
				dynamic_param_classes={"input_grib": "grib"},
				environment=TaskEnvironment(packages=["numpy<2.0.0", "earthkit-data"]),
			)
		case RegisteredTask.mars_enfo_range_temp:
			return TaskDefinition(
				user_params={
					"lat": TaskParameter(clazz="latitude"),
					"lon": TaskParameter(clazz="longitude"),
				},
				entrypoint="forecastbox.external.data_sources.enfo_range_temp_query",
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


def build_pipeline(job_pipeline: str) -> Either[list[RegisteredTask], list[str]]:
	# NOTE this would probably become a javascript thingy
	tasks: list[RegisteredTask] = []
	errors: list[str] = []
	for task in job_pipeline.split("->"):
		try:
			tasks.append(RegisteredTask(task.strip()))
		except Exception as e:
			emsg = f"failed to parse task {task[:32]} due to {repr(e)}"
			logger.exception(emsg)
			errors.append(emsg)
	if errors:
		return Either.error(errors)
	else:
		return Either.ok(tasks)


def resolve_builder_linear(task_names: list[RegisteredTask]) -> Either[TaskDAGBuilder, list[str]]:
	# TODO wrap in try catch, extend the validation
	tasks: list[tuple[str, TaskDefinition]] = []
	dynamic_task_inputs = {}
	errors = []
	for i, e in enumerate(task_names):
		task = get_task(e)
		dyn_params = len(task.dynamic_param_classes)
		if dyn_params == 1:
			dynamic_task_inputs[e.value] = {list(task.dynamic_param_classes.keys())[0]: tasks[i - 1][0]}
		elif dyn_params > 1:
			errors.append(f"task {e.value} at position {i} in the sequence needs >1 dyn params, unsupported")
			continue
		tasks.append(
			(
				e.value,
				task,
			)
		)
	final_output_at = task_names[-1].value
	rv = TaskDAGBuilder(tasks=tasks, dynamic_task_inputs=dynamic_task_inputs, final_output_at=final_output_at)
	return validation.of_builder(rv).append(errors)

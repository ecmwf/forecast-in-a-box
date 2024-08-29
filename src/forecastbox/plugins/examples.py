"""
Focuses on working with JobTemplateExamples:
 - converting a selected example into HTML form, more convenient than plain list[RegisteredTask] would lead to
 - converting the selected example + HTML form result into a TaskDAGBuilder
"""

from forecastbox.api.common import RegisteredTask, TaskDAGBuilder, JobTemplateExample, JinjaTemplate, TaskParameter
from forecastbox.utils import assert_never, Either
from forecastbox.plugins.lookup import resolve_builder_linear
from typing import Any, Iterable
import logging

logger = logging.getLogger(__name__)


def to_builder(job_type: JobTemplateExample) -> Either[TaskDAGBuilder, list[str]]:
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
			return resolve_builder_linear([RegisteredTask.mars_oper_sfc_box, RegisteredTask.plot_single_grib])
		case JobTemplateExample.temperature_nbeats:
			return resolve_builder_linear([RegisteredTask.mars_enfo_range_temp, RegisteredTask.nbeats_predict])
		case JobTemplateExample.hello_aifsl:
			return resolve_builder_linear([RegisteredTask.aifs_fetch_and_predict, RegisteredTask.plot_single_grib])
		case s:
			assert_never(s)


def to_jinja_template(example: JobTemplateExample) -> JinjaTemplate:
	match example:
		case JobTemplateExample.hello_aifsl:
			return JinjaTemplate.aifs
		case _:
			return JinjaTemplate.prepare


def params_to_jinja(task_name_prefix: str, params: Iterable[tuple[str, TaskParameter]]) -> list[tuple[str, str, str]]:
	return [
		(
			f"{task_name_prefix}.{param_name}",
			param.clazz,
			param.default,
		)
		for param_name, param in params
	]


def to_form_params_aifs(builder: TaskDAGBuilder) -> Either[dict[str, Any], list[str]]:
	"""Used for aifs special template"""
	# A bit hardcoded / coupled to the dag structure which is declared elsewhere... we need a different abstraction here
	tasks = dict(builder.tasks)
	if extra_keys := set(tasks.keys()) - {RegisteredTask.aifs_fetch_and_predict, RegisteredTask.plot_single_grib}:
		logger.error(f"found extra task keys: {extra_keys}")
		return Either.error(["internal issue: failed to construct input"])

	initial = [
		("start_date", "datetime", "Initial conditions from"),
	]
	model = [
		("target_step", "text", "Target step", "6"),
		("predicted_params", "text", "Parameters", "2t"),
		("model_id", "dropdown", "Model ID", ["aifs-small"]),
	]
	output = [
		("box_lat1", "text", "Latitude left"),
		("box_lat2", "text", "Latitude right"),
		("box_lon1", "text", "Longitude top"),
		("box_lon2", "text", "Longitude bottom"),
	]
	return Either.ok(
		{
			"initial": initial,
			"model": model,
			"output": output,
		}
	)


def from_form_params_aifs(form_params: dict[str, str]) -> Either[dict[str, str], list[str]]:
	mapped = {
		f"{RegisteredTask.aifs_fetch_and_predict.value}.predicted_params": form_params.get("predicted_params", ""),
		f"{RegisteredTask.aifs_fetch_and_predict.value}.target_step": form_params.get("target_step", ""),
		f"{RegisteredTask.aifs_fetch_and_predict.value}.start_date": form_params.get("start_date", ""),
		f"{RegisteredTask.aifs_fetch_and_predict.value}.model_id": form_params.get("model_id", ""),
		f"{RegisteredTask.plot_single_grib.value}.box_lat1": form_params.get("box_lat1", ""),
		f"{RegisteredTask.plot_single_grib.value}.box_lat2": form_params.get("box_lat2", ""),
		f"{RegisteredTask.plot_single_grib.value}.box_lon1": form_params.get("box_lon1", ""),
		f"{RegisteredTask.plot_single_grib.value}.box_lon2": form_params.get("box_lon2", ""),
		f"{RegisteredTask.plot_single_grib.value}.grib_idx": "0",
		f"{RegisteredTask.plot_single_grib.value}.grib_param": form_params.get("predicted_params", ""),
	}

	return Either.ok(mapped)


def to_form_params(example: JobTemplateExample) -> Either[dict[str, Any], list[str]]:
	"""Returns data used to building the HTML form"""
	maybe_builder = to_builder(example)
	if maybe_builder.e:
		return Either.error(maybe_builder.e)
	builder = maybe_builder.get_or_raise()
	params: dict[str, Any]
	match example:
		case JobTemplateExample.hello_aifsl:
			maybe_params = to_form_params_aifs(builder)
			if maybe_params.e:
				return Either.error(maybe_params.e)
			else:
				params = maybe_params.get_or_raise()
		case _:
			job_params_gen = (
				params_to_jinja(task_name, task_definition.user_params.items()) for task_name, task_definition in builder.tasks
			)
			params = {"params": sum(job_params_gen, [])}
	form_params = {"job_name": example.value, "job_type": "example", **params}
	return Either.ok(form_params)


def from_form_params(example: JobTemplateExample, form_params: dict[str, str]) -> Either[dict[str, str], list[str]]:
	"""From the filled HTML form creates a dictionary that the TaskDAGBuilder can process"""
	match example:
		case JobTemplateExample.hello_aifsl:
			return from_form_params_aifs(form_params)
		case _:
			return Either.ok(form_params)

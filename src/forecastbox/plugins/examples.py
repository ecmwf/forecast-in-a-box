"""
Focuses on working with JobTemplateExamples:
 - converting a selected example into HTML form, more convenient than plain list[RegisteredTask] would lead to
 - converting the selected example + HTML form result into a TaskDAGBuilder
"""

from forecastbox.api.common import RegisteredTask, TaskDAGBuilder, JobTemplateExample, JinjaTemplate, TaskParameter, TaskDefinition
import forecastbox.api.validation as validation
from forecastbox.utils import assert_never, Either
from forecastbox.plugins.lookup import resolve_builder_linear, get_task
from typing import Any, Iterable
import logging
import os
import pathlib

logger = logging.getLogger(__name__)


def to_builder(job_type: JobTemplateExample, params: dict[str, str]) -> Either[TaskDAGBuilder, list[str]]:
	"""Looks up a job template -- for retrieving the list of user params / filling it with params
	to obtain a job definition"""
	# NOTE it's a bit unfortunate: for the aifs we call this only *after* we have the params already,
	# whereas for the other examples we call this *before* the params, so the semantics is confusing
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
			tasks: list[tuple[str, TaskDefinition]] = []
			dynamic_task_inputs = {}
			T0 = RegisteredTask.aifs_fetch_and_predict
			tasks.append((T0.value, get_task(T0)))
			final_output_at: str = ""
			if "output_type_file" in params:
				Ts = RegisteredTask.grib_to_file
				tasks.append((Ts.value, get_task(Ts)))
				dynamic_task_inputs[Ts.value] = {"input_grib": T0.value}
				final_output_at = Ts.value  # may get overwritten but thats legit
			if "output_type_plot" in params:
				T1 = RegisteredTask.grib_mir
				tasks.append((T1.value, get_task(T1)))
				T2 = RegisteredTask.plot_single_grib
				tasks.append((T2.value, get_task(T2)))
				dynamic_task_inputs[T1.value] = {"input_grib": T0.value}
				dynamic_task_inputs[T2.value] = {"input_grib": T1.value}
				final_output_at = T2.value
			rv = TaskDAGBuilder(tasks=tasks, dynamic_task_inputs=dynamic_task_inputs, final_output_at=final_output_at)
			return validation.of_builder(rv)
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


def to_form_params_aifs() -> Either[dict[str, Any], list[str]]:
	"""Used for aifs special template"""
	# A bit hardcoded / coupled to the dag structure which is declared elsewhere... we need a different abstraction here
	initial = [
		("start_date", "datetime", "Initial conditions from"),
	]
	model = [
		("target_step", "text", "Target step", "6"),
		("predicted_params", "text", "Parameters", "2t"),
		("model_id", "dropdown", "Model ID", ["aifs-small"]),
		("postprocessing", "dropdown", "Postprocessing function", ["None", "None, but different"]),
	]
	output = [
		(
			"output_type",
			"checkbox",
			"how to save the results",
			[("output_type_file", "As a grib file", "tp_file_"), ("output_type_plot", "As a plot", "tp_plot_")],
		),
		("tp_plot_box_lat1", "text", "Latitude top"),
		("tp_plot_box_lat2", "text", "Latitude bottom"),
		("tp_plot_box_lon1", "text", "Longitude left"),
		("tp_plot_box_lon2", "text", "Longitude right"),
		("tp_file_filepath", "text", "Path"),
	]
	return Either.ok(
		{
			"initial": initial,
			"model": model,
			"output": output,
		}
	)


def from_form_params_aifs(form_params: dict[str, str]) -> Either[dict[str, str], list[str]]:
	errors = []
	mapped = {
		f"{RegisteredTask.aifs_fetch_and_predict.value}.predicted_params": form_params.get("predicted_params", ""),
		f"{RegisteredTask.aifs_fetch_and_predict.value}.target_step": form_params.get("target_step", ""),
		f"{RegisteredTask.aifs_fetch_and_predict.value}.start_date": form_params.get("start_date", ""),
		f"{RegisteredTask.aifs_fetch_and_predict.value}.model_id": form_params.get("model_id", ""),
	}
	if "output_type_plot" in form_params:
		n = form_params.get("tp_plot_box_lat1", "")
		s = form_params.get("tp_plot_box_lat2", "")
		w = form_params.get("tp_plot_box_lon1", "")
		e = form_params.get("tp_plot_box_lon2", "")
		mapped.update(
			{
				f"{RegisteredTask.plot_single_grib.value}.box_lat1": n,
				f"{RegisteredTask.plot_single_grib.value}.box_lat2": s,
				f"{RegisteredTask.plot_single_grib.value}.box_lon1": w,
				f"{RegisteredTask.plot_single_grib.value}.box_lon2": e,
				f"{RegisteredTask.plot_single_grib.value}.grib_idx": "0",
				f"{RegisteredTask.plot_single_grib.value}.grib_param": form_params.get("predicted_params", ""),
				f"{RegisteredTask.grib_mir.value}.area": f"{n}/{w}/{s}/{e}",
			}
		)
	if "output_type_file" in form_params:
		path = form_params.get("tp_file_filepath", "")
		if not path:
			errors.append("output path for grib file must be non-empty and writeable")
		elif not os.access(pathlib.Path(path).parent, os.W_OK):
			errors.append(f"output path for grib file is not writeable: {path}")
		else:
			mapped[f"{RegisteredTask.grib_to_file.value}.path"] = path
	if "output_type_plot" not in form_params and "output_type_file" not in form_params:
		errors.append("missing output specification: neither Plot nor File were chosen")

	if errors:
		return Either.error(errors)
	else:
		return Either.ok(mapped)


def to_form_params(example: JobTemplateExample) -> Either[dict[str, Any], list[str]]:
	"""Returns data used to building the HTML form"""
	params: dict[str, Any]
	match example:
		case JobTemplateExample.hello_aifsl:
			maybe_params = to_form_params_aifs()
			if maybe_params.e:
				return Either.error(maybe_params.e)
			else:
				params = maybe_params.get_or_raise()
		case _:
			maybe_builder = to_builder(example, {})
			if maybe_builder.e:
				return Either.error(maybe_builder.e)
			builder = maybe_builder.get_or_raise()
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

"""
Focuses on working with JobTemplateExamples:
 - converting a selected example into HTML form, more convenient than plain list[RegisteredTask] would lead to
 - converting the selected example + HTML form result into a TaskDAGBuilder
"""

from forecastbox.api.common import RegisteredTask, TaskDAGBuilder, JobTemplateExample
from forecastbox.utils import assert_never, Either
from forecastbox.plugins.lookup import resolve_builder_linear
from typing import Any


def to_builder(job_type: JobTemplateExample) -> Either[TaskDAGBuilder, str]:
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


def to_form_params(example: JobTemplateExample) -> Either[dict[str, Any], str]:
	"""Returns data used to building the HTML form"""
	maybe_builder = to_builder(example)
	if maybe_builder.e:
		return Either.error(maybe_builder.e)
	builder = maybe_builder.get_or_raise()
	job_params = [
		(
			f"{task_name}.{param_name}",
			param.clazz,
			param.default,
			f"Fancy name for {task_name}.{param_name}",
		)
		for task_name, task_definition in builder.tasks
		for param_name, param in task_definition.user_params.items()
	]
	form_params = {"job_name": example.value, "job_type": "example", "params": job_params}
	return Either.ok(form_params)


def from_form_params(example: JobTemplateExample, form_params: dict[str, str]) -> dict[str, str]:
	"""From the filled HTML form creates a dictionary that the TaskDAGBuilder can process"""
	return form_params

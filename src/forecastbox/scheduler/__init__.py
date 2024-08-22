"""
Converts high level input of the user into an execution plan (sequence of individual functions) to be run on the worker(s)
"""

from forecastbox.api.common import JobTemplate, TaskDAG, Task, DatasetId
from collections import defaultdict
from forecastbox.utils import Either
import forecastbox.api.validation as validation


def linearize(job_definition: TaskDAG) -> TaskDAG:
	"""A placeholder method for converting a schedule-agnostic dag into an execution plan"""
	return job_definition


def build(job_template: JobTemplate, params: dict[str, str]) -> Either[TaskDAG, str]:
	# TODO wrap in try catch
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
	task_dag = TaskDAG(tasks=tasks, output_id=DatasetId(dataset_id=job_template.final_output_at), job_type=job_template.job_type)
	return validation.of_dag(task_dag, job_template)
	# TODO if extra params (both on task and on dag level), append errors here

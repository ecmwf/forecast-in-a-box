"""
Converts high level input of the user into an execution plan (sequence of individual functions) to be run on the worker(s)
"""

from forecastbox.api.common import TaskDAGBuilder, TaskDAG, Task, DatasetId, TaskDefinition
from typing import Any
from collections import defaultdict
from forecastbox.utils import Either
import forecastbox.api.validation as validation
from forecastbox.api.type_system import convert


def linearize(job_definition: TaskDAG) -> TaskDAG:
	"""A placeholder method for converting a schedule-agnostic dag into an execution plan"""
	return job_definition


def build(builder: TaskDAGBuilder, params: dict[str, str]) -> Either[TaskDAG, list[str]]:
	errors: list[str] = []
	# TODO wrap in try catch
	task_defin: dict[str, TaskDefinition] = dict(builder.tasks)
	params_per_task: dict[str, dict[str, Any]] = defaultdict(dict)
	for k, v in params.items():
		task_name, param = k.split(".", 1)
		if task_name not in task_defin:
			errors.append(f"found param {param} for task {task_name}, but no such task was defined")
			continue
		if param not in task_defin[task_name].user_params:
			errors.append(f"found param {param} for task {task_name} which declares no such param")
			continue
		clazz = task_defin[task_name].user_params[param].clazz
		res = convert(clazz, v)
		if res.e:
			errors.append(f"value {v[:32]} for param {param} of task {task_name} failed to serialize to {clazz} because of {res.e}")
			continue
		params_per_task[task_name][param] = res.t
	tasks = [
		Task(
			name=task_name,
			static_params_kw=params_per_task[task_name],
			static_params_ps={},
			dataset_inputs_kw={k: DatasetId(dataset_id=v) for k, v in builder.dynamic_task_inputs.get(task_name, {}).items()},
			dataset_inputs_ps={},
			entrypoint=task_definition.entrypoint,
			func=None,
			output_name=DatasetId(dataset_id=task_name),
			environment=task_definition.environment,
		)
		for task_name, task_definition in builder.tasks
	]
	task_dag = TaskDAG(tasks=tasks, output_id=DatasetId(dataset_id=builder.final_output_at))
	return validation.of_dag(task_dag, builder).append(errors)

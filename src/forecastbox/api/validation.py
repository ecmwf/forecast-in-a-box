"""
Validations of TaskDAGs and TaskDAGBuilders for consistency
"""

import logging
from forecastbox.api.common import TaskDAGBuilder, TaskDAG, TaskDefinition
from forecastbox.utils import Either

logger = logging.getLogger(__name__)


def of_builder(builder: TaskDAGBuilder) -> Either[TaskDAGBuilder, list[str]]:
	errors: list[str] = []

	try:
		task_order: dict[str, int] = {}
		for i, task in enumerate(builder.tasks):
			name = task[0]
			if name in task_order:
				errors.append(f"task {name} first seen at position {task_order[name]} but repeated at {i}")
			else:
				task_order[name] = i
		for this_n, dynputs in builder.dynamic_task_inputs.items():
			this_i = task_order[this_n]
			this_t = builder.tasks[this_i][1]
			for param, provider in dynputs.items():
				if provider not in task_order:
					errors.append(f"task {this_n} is supposed to received param {param} from {provider} but no such task is known")
					continue
				that_i = task_order[provider]
				that_t = builder.tasks[that_i][1]
				if that_i >= this_i:
					errors.append(f"task {this_n} needs param {param} from {provider} which does not come before in the schedule")
				if param not in this_t.dynamic_param_classes:
					errors.append(f"task {this_n} does not declare input {param} yet builder fills it")
				elif (this_c := this_t.dynamic_param_classes[param]) != (that_c := that_t.output_class):
					errors.append(f"task {this_n} needs param {param} to be {this_c} but {provider} outputs {that_c}")
			missing = this_t.dynamic_param_classes.keys() - dynputs.keys()
			if missing:
				errors.append(f"task {this_n} is missing dynamic inputs {', '.join(missing)}")
		if not errors:
			return Either.ok(builder)
	except Exception as e:
		logger.exception("validation failed exceptionally")
		errors.append(f"exception during validation: {e}")

	return Either.error(errors)


def of_dag(task_dag: TaskDAG, builder: TaskDAGBuilder) -> Either[TaskDAG, list[str]]:
	# NOTE Assumes the respective builder has already been validated, and that the task dag was built from it
	# TODO We may simply merge this method with scheduler.build, because that one implicitly validates as well

	errors: list[str] = []

	try:
		task_defin: dict[str, TaskDefinition] = dict(builder.tasks)
		for task in task_dag.tasks:
			defin = task_defin[task.name]
			missing = defin.user_params.keys() - task.static_params.keys()
			if missing:
				errors.append(f"task {task.name} is missing user params {', '.join(sorted(missing))}")
		if not errors:
			return Either.ok(task_dag)
	except Exception as e:
		logger.exception("validation failed exceptionally")
		errors.append(f"exception during validation: {e}")

	return Either.error(errors)

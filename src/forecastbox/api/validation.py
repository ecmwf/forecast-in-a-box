"""
Validations of TaskDAGs and JobTemplates for consistency
"""

import logging
from forecastbox.api.common import JobTemplate, TaskDAG
from forecastbox.utils import Either

logger = logging.getLogger(__name__)


def of_template(template: JobTemplate) -> Either[JobTemplate, str]:
	errors: list[str] = []

	try:
		task_order: dict[str, int] = {}
		for i, task in enumerate(template.tasks):
			name = task[0]
			if name in task_order:
				errors.append(f"task {name} first seen at position {task_order[name]} but repeated at {i}")
			else:
				task_order[name] = i
		for this_n, dynputs in template.dynamic_task_inputs.items():
			this_i = task_order[this_n]
			this_t = template.tasks[this_i][1]
			for param, provider in dynputs.items():
				if provider not in task_order:
					errors.append(f"task {this_n} is supposed to received param {param} from {provider} but no such task is known")
					continue
				that_i = task_order[provider]
				that_t = template.tasks[that_i][1]
				if that_i >= this_i:
					errors.append(f"task {this_n} needs param {param} from {provider} which does not come before in the schedule")
				if param not in this_t.dynamic_param_classes:
					errors.append(f"task {this_n} does not declare input {param} yet template fills it")
				elif (this_c := this_t.dynamic_param_classes[param]) != (that_c := that_t.output_class):
					errors.append(f"task {this_n} needs param {param} to be {this_c} but {provider} outputs {that_c}")
			missing = this_t.dynamic_param_classes.keys() - dynputs.keys()
			if missing:
				errors.append(f"task {this_n} is missing dynamic inputs {', '.join(missing)}")
		if not errors:
			return Either.ok(template)
	except Exception as e:
		logger.exception("validation failed exceptionally")
		errors.append(f"exception during validation: {e}")

	return Either.error("\n".join(errors))


def of_dag(task_dag: TaskDAG) -> Either[TaskDAG, str]:
	return Either.ok(task_dag)

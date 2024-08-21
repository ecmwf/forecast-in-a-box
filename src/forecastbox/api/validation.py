"""
Validations of TaskDAGs and JobTemplates for consistency
"""

from forecastbox.api.common import JobTemplate, TaskDAG
from forecastbox.utils import Either


def of_template(template: JobTemplate) -> Either[JobTemplate, str]:
	return Either.ok(template)


def of_dag(task_dag: TaskDAG) -> Either[TaskDAG, str]:
	return Either.ok(task_dag)

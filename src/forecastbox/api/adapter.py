"""
Cascade2Fiab adapter -- basically making the execution-agnostic objects of cascade aware of the
execution context of fiab
"""

# NOTE a chunk of work here is just due to interfaces being a bit different, without any
# profound need. We'll eventually make parts of the original fiab interface go away, which will
# simplify this

from cascade.v2.core import JobInstance, Schedule, TaskInstance as CascadeTask
from cascade.v2.views import param_source
from forecastbox.api.common import DatasetId, TaskDAG, Task as FiabTask, TaskEnvironment
from forecastbox.utils import Either, maybe_head
from typing import Optional, cast


def param2dsid(task_name: str, param_name: Optional[str]) -> Optional[DatasetId]:
	if not param_name:
		return None
	return DatasetId(dataset_id=task_name + "=>" + param_name)


def cascade2fiab(job_instance: JobInstance, schedule: Schedule) -> Either[TaskDAG, list[str]]:
	errs = []
	if len(schedule.host_task_queues) > 1:
		errs.append("fiab supports only one worker")
	if culprits := [name for name, instance in job_instance.tasks.items() if len(instance.definition.output_schema) > 1]:
		errs.append(f"tasks have multiple outputs, unsupported: {', '.join(culprits)}")
	if errs:
		return Either.error(errs)

	output_name = lambda task_definition: maybe_head(task_definition.output_schema.keys())
	inputs_lookup = param_source(job_instance.edges)

	worker_queue_c: list[tuple[str, CascadeTask]] = [
		(
			e,
			job_instance.tasks[e],
		)
		for e in next(iter(schedule.host_task_queues.values()))
	]
	worker_queue_f: list[FiabTask] = [
		FiabTask(
			name=name,
			static_params=task.static_input,
			dataset_inputs={
				input_param: cast(DatasetId, param2dsid(source_task, source_output))
				for input_param, (source_task, source_output) in inputs_lookup[name].items()
			},
			entrypoint=task.definition.entrypoint,
			func=task.definition.func,
			output_name=param2dsid(name, output_name(task.definition)),
			environment=TaskEnvironment(packages=task.definition.environment),
		)
		for name, task in worker_queue_c
	]

	td = TaskDAG(
		tasks=worker_queue_f,
		output_id=worker_queue_f[-1].output_name,
	)
	return Either.ok(td)

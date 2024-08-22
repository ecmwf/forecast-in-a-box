"""
Target for a new launched process corresponding to a single task
"""

# TODO we launch process per job (whole task dag) -- refactor to process per task in the dag. Would split this in two files
# TODO move some of the memory management parts into worker/db.py

from forecastbox.worker.reporting import notify_update, CallbackContext
from forecastbox.api.common import Task, TaskDAG, JobStatusEnum
from forecastbox.worker.db import DbContext
from multiprocessing import Process
from multiprocessing.shared_memory import SharedMemory
from forecastbox.worker.db import MemDb
from typing import Callable, Any
import importlib
import logging
import hashlib

logger = logging.getLogger(__name__)


def shmid(job_id: str, dataset_id: str) -> str:
	# we cant use too long file names for shm, https://trac.macports.org/ticket/64806
	h = hashlib.new("md5", usedforsecurity=False)
	h.update((job_id + dataset_id).encode())
	return h.hexdigest()[:24]


def get_process_target(task: Task) -> Callable:
	module_name, function_name = task.entrypoint.rsplit(".", 1)
	module = importlib.import_module(module_name)
	return module.__dict__[function_name]


def job_entrypoint(callback_context: CallbackContext, mem_db: MemDb, job_id: str, definition: TaskDAG) -> None:
	logging.basicConfig(level=logging.DEBUG)  # TODO replace with config
	notify_update(callback_context, job_id, JobStatusEnum.running, task_name=None)

	try:
		for task in definition.tasks:
			notify_update(callback_context, job_id, JobStatusEnum.running, task_name=task.name)
			target = get_process_target(task)
			params: dict[str, Any] = {}
			params.update(task.static_params)
			mems = {}
			for param_name, dataset_id in task.dataset_inputs.items():
				key = shmid(job_id, dataset_id.dataset_id)
				if dataset_id.dataset_id not in mems:
					logger.debug(f"opening dataset id {dataset_id.dataset_id} in {job_id=}")
					mems[key] = SharedMemory(name=key, create=False)
				# NOTE it would be tempting to do just buf[:L] here. Alas, that would trigger exception
				# later when closing the shm -- python would sorta leak the pointer via the dictionary.
				# We need the _len param because the buffer is padded by zeros, and the formats generally
				# don't have a stop word.
				params[param_name] = mems[key].buf
				params[param_name + "_len"] = mem_db.memory[key]

			logger.debug(f"running task {task.name} in {job_id=} with kwarg keys {','.join(params.keys())}")
			result = target(**params)
			logger.debug(f"finished task {task.name} in {job_id=}")
			notify_update(callback_context, job_id, JobStatusEnum.finished, task_name=task.name)

			if task.output_name:
				L = len(result)
				key = shmid(job_id, task.output_name.dataset_id)
				logger.debug(f"result of len {L} from {job_id=}'s {task.output_name.dataset_id} stored as {key}")
				mem = SharedMemory(name=key, create=True, size=L)
				mem.buf[:L] = result
				mem.close()
				mem_db.memory[key] = L

			for key, mem in mems.items():
				logger.debug(f"closing shm {key}")
				mem.close()

		logger.debug(f"finished {job_id=}")
		if definition.output_id:
			output_name = shmid(job_id, definition.output_id.dataset_id)
		else:
			output_name = None
		notify_update(callback_context, job_id, JobStatusEnum.finished, result=output_name, task_name=None)
	except Exception:
		# TODO free all datasets
		logger.exception(f"job with {job_id=} failed")
		notify_update(callback_context, job_id, JobStatusEnum.failed)


def job_factory(callback_context: CallbackContext, db_context: DbContext, job_id: str, definition: TaskDAG) -> Process:
	params = {
		"callback_context": callback_context,
		"mem_db": db_context.mem_db,
		"job_id": job_id,
		"definition": definition,
	}
	return Process(target=job_entrypoint, kwargs=params)

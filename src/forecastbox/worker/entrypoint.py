"""
Target for a new launched process corresponding to a single task
"""

# TODO we launch process per job (whole task dag) -- refactor to process per task in the dag. Would split this in two files
# TODO move some of the memory management parts into worker/db.p

from forecastbox.worker.reporting import notify_update, CallbackContext
from forecastbox.api.common import TaskDAG, JobStatusEnum, TaskEnvironment, DatasetId, Task
from forecastbox.worker.db import DbContext
from multiprocessing import Process, Pipe
from multiprocessing.shared_memory import SharedMemory
from multiprocessing.connection import Connection
from forecastbox.worker.db import MemDb, shm_worker_close
import forecastbox.worker.environment_manager as environment_manager
from typing import Callable, Any, cast, Iterable, Optional
import importlib
import logging
from forecastbox.utils import logging_config
import hashlib

logger = logging.getLogger(__name__)


def shmid(job_id: str, dataset_id: str) -> str:
	# we cant use too long file names for shm, https://trac.macports.org/ticket/64806
	h = hashlib.new("md5", usedforsecurity=False)
	h.update((job_id + dataset_id).encode())
	return h.hexdigest()[:24]


def get_process_target(entrypoint: str) -> Callable:
	module_name, function_name = entrypoint.rsplit(".", 1)
	module = importlib.import_module(module_name)
	return module.__dict__[function_name]


def task_entrypoint(
	entrypoint: Optional[str],
	func: Optional[str],
	output_mem_key: str,
	mem_db: MemDb,
	job_id: str,
	params: dict,
	dsids: Iterable[tuple[str, DatasetId]],
	ex_pipe: Connection,
) -> None:
	try:
		mems = {}
		for param_name, dataset_id in dsids:
			key = shmid(job_id, dataset_id.dataset_id)
			if dataset_id.dataset_id not in mems:
				logger.debug(f"opening dataset id {dataset_id.dataset_id} in {job_id=} with {key=}")
				mems[key] = SharedMemory(name=key, create=False)
			params[param_name] = mems[key].buf[: mem_db.memory[key]]

		if func is not None:
			target = Task.func_dec(func)
		else:
			if not entrypoint:
				raise TypeError("neither entrypoint nor func given")
			target = get_process_target(entrypoint)
		result = target(**params)

		if output_mem_key:
			L = len(result)
			logger.debug(f"result of len {L} in {job_id=} stored as {output_mem_key}")
			mem = SharedMemory(name=output_mem_key, create=True, size=L)
			mem.buf[:L] = result
			shm_worker_close(mem)
			mem_db.memory[output_mem_key] = L
		del result

		# this is required so that the Shm can be properly freed
		for param_name, dataset_id in dsids:
			del params[param_name]

		for key, mem in mems.items():
			mem.buf.release()
			shm_worker_close(mem)
	except Exception as e:
		ex_pipe.send(repr(e))
		raise


class TaskExecutionException(Exception):
	def __init__(self, task, exception):
		self.task = task
		self.exception = exception
		super().__init__(f"{task}: {exception}")


def job_entrypoint(callback_context: CallbackContext, mem_db: MemDb, job_id: str, definition: TaskDAG) -> bool:
	logging.config.dictConfig(logging_config)
	logging.getLogger("httpcore").setLevel(logging.ERROR)
	logging.getLogger("httpx").setLevel(logging.ERROR)
	notify_update(callback_context, job_id, JobStatusEnum.preparing, task_name=None)
	# mypy bug
	environment = cast(TaskEnvironment, sum((task.environment for task in definition.tasks), TaskEnvironment()))
	env_context = environment_manager.prepare(job_id, environment)
	notify_update(callback_context, job_id, JobStatusEnum.running, task_name=None)

	try:
		for task in definition.tasks:
			notify_update(callback_context, job_id, JobStatusEnum.running, task_name=task.name)
			params: dict[str, Any] = {}
			params.update(task.static_params)

			logger.debug(f"running task {task.name} in {job_id=} with kwarg keys {','.join(params.keys())}")
			if task.output_name:
				key = shmid(job_id, task.output_name.dataset_id)
			else:
				key = ""
			dsids = task.dataset_inputs.items()
			ex_src, ex_snk = Pipe(duplex=False)
			task_process = Process(target=task_entrypoint, args=(task.entrypoint, task.func, key, mem_db, job_id, params, dsids, ex_snk))
			logger.debug(f"launching process for {task.name}")
			task_process.start()
			task_process.join()
			logger.debug(f"finished task {task.name} in pid {task_process.pid} with {task_process.exitcode} in {job_id=}")
			if task_process.exitcode != 0:
				if ex_src.poll(1):
					raise TaskExecutionException(f"{task.name}", ex_src.recv())
				else:
					raise TaskExecutionException(f"{task.name}", "unable to diagnose the problem")
			notify_update(callback_context, job_id, JobStatusEnum.finished, task_name=task.name)

		logger.debug(f"finished {job_id=}")
		if definition.output_id:
			output_name = shmid(job_id, definition.output_id.dataset_id)
		else:
			output_name = None
		notify_update(callback_context, job_id, JobStatusEnum.finished, result=output_name, task_name=None)
	except TaskExecutionException as e:
		m = repr(e.exception)
		logger.exception(f"job with {job_id=} failed with {m}")
		notify_update(callback_context, job_id, JobStatusEnum.failed, status_detail=f" -- Failed in {e.task} with {m}")
		return False
	except ValueError as e:
		logger.exception(f"job with {job_id=} failed *unfathomably*")
		notify_update(callback_context, job_id, JobStatusEnum.failed, status_detail=f" -- Failed because {repr(e)}")
		return False
	finally:
		# TODO free all datasets?
		if env_context is not None:
			env_context.cleanup()
		callback_context.close()
	return True


def job_factory(callback_context: CallbackContext, db_context: DbContext, job_id: str, definition: TaskDAG) -> Process:
	params = {
		"callback_context": callback_context,
		"mem_db": db_context.mem_db,
		"job_id": job_id,
		"definition": definition,
	}
	return Process(target=job_entrypoint, kwargs=params)

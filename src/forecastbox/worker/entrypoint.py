"""
Target for a new launched process corresponding to a single task
"""

# TODO we launch process per job (whole task dag) -- refactor to process per task in the dag. Would split this in two files
# TODO move some of the memory management parts into worker/db.p

from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass
from forecastbox.worker.reporting import notify_update, CallbackContext
from forecastbox.api.common import TaskDAG, JobStatusEnum, TaskEnvironment, Task
from forecastbox.worker.db import DbContext
from multiprocessing import Process, Pipe
from multiprocessing.shared_memory import SharedMemory
from multiprocessing.connection import Connection
from forecastbox.worker.db import MemDb, shm_worker_close
from forecastbox.worker.environment_manager import Environment
from typing import Callable, Any, Optional, Iterator, Literal
import importlib
import logging
import logging.config
from forecastbox.utils import logging_config, ensure
import hashlib
from forecastbox.worker import serde

logger = logging.getLogger(__name__)


def shmid(job_id: str, dataset_id: str) -> str:
	# we cant use too long file names for shm, https://trac.macports.org/ticket/64806
	h = hashlib.new("md5", usedforsecurity=False)
	h.update((job_id + dataset_id).encode())
	return h.hexdigest()[:24]


@dataclass
class DynamicDataset:
	key: str
	annotation: str


@dataclass
class ExecutionPayload:
	"""Passed from worker-main-process to worker-task-process, contains all info to fully execute a task"""

	entrypoint: Optional[str]
	func: Optional[str]
	output: Optional[DynamicDataset]
	st_kwargs: dict[str, Any]
	st_args: dict[int, Any]
	dn_kwargs: dict[str, DynamicDataset]
	dn_args: dict[int, DynamicDataset]
	environment: TaskEnvironment


@dataclass
class ExecutionContext:
	"""Objects needed during execution but not related to the task itself"""

	mem_db: MemDb
	ex_pipe: Connection


class ExecutionMemoryManager(AbstractContextManager):
	"""Handles opening and closing of SharedMemory objects, including their SerDe, within single task execution"""

	mems: dict[str, SharedMemory]

	def __init__(self, mem_db: MemDb) -> None:
		self.mems = {}
		self.mem_db = mem_db

	def get(self, dataset: DynamicDataset) -> Any:
		if dataset.key not in self.mem_db.memory:
			raise ValueError(f"attempted to open non-registered dataset {dataset}")
		if dataset.key not in self.mems:
			logger.debug(f"opening dataset {dataset}")
			self.mems[dataset.key] = SharedMemory(name=dataset.key, create=False)
		raw = self.mems[dataset.key].buf[: self.mem_db.memory[dataset.key]]
		return serde.from_bytes(raw, dataset.annotation)

	def put(self, data: Any, dataset: DynamicDataset) -> None:
		result_ser = serde.to_bytes(data, dataset.annotation)
		L = len(result_ser)
		logger.debug(f"storing result of len {L} as {dataset}")
		mem = SharedMemory(name=dataset.key, create=True, size=L)
		mem.buf[:L] = result_ser
		shm_worker_close(mem)
		self.mem_db.memory[dataset.key] = L

	def __exit__(self, exc_type, exc_val, exc_tb) -> Literal[False]:
		for key, mem in self.mems.items():
			mem.buf.release()
			shm_worker_close(mem)
		return False


@contextmanager
def ExceptionReporter(connection: Connection) -> Iterator[int]:
	try:
		yield 1  # dummy for contextmanager protocol
	except Exception as e:
		logger.exception("reporting task crash")
		connection.send(repr(e))
		raise


def get_callable(target: ExecutionPayload) -> Callable:
	if target.func is not None:
		return Task.func_dec(target.func)
	elif target.entrypoint is not None:
		module_name, function_name = target.entrypoint.rsplit(".", 1)
		module = importlib.import_module(module_name)
		return module.__dict__[function_name]
	else:
		raise TypeError("neither entrypoint nor func given")


def task_entrypoint(payload: ExecutionPayload, context: ExecutionContext) -> None:
	with ExceptionReporter(context.ex_pipe), Environment(payload.environment.packages), ExecutionMemoryManager(context.mem_db) as mems:
		logging.config.dictConfig(logging_config)

		args: list[Any] = []
		for idx, param in payload.st_args.items():
			ensure(args, idx)
			args[idx] = param
		for idx, param in payload.dn_args.items():
			ensure(args, idx)
			args[idx] = mems.get(param)
		kwargs: dict[str, Any] = {}
		kwargs.update(payload.st_kwargs)
		for key, param in payload.dn_kwargs.items():
			kwargs[key] = mems.get(param)

		kallable = get_callable(payload)
		result = kallable(*args, **kwargs)

		if payload.output is not None:
			mems.put(result, payload.output)
		del result

		# this is required so that the Shm can be properly freed
		for name in payload.dn_kwargs.keys():
			del kwargs[name]
		for idx in payload.dn_args.keys():
			del args[idx]


class TaskExecutionException(Exception):
	def __init__(self, task, exception):
		self.task = task
		self.exception = exception
		super().__init__(f"{task}: {exception}")


def job_entrypoint(callback_context: CallbackContext, mem_db: MemDb, job_id: str, definition: TaskDAG) -> bool:
	notify_update(callback_context, job_id, JobStatusEnum.running, task_name=None)

	try:
		for task in definition.tasks:
			notify_update(callback_context, job_id, JobStatusEnum.running, task_name=task.name)

			output = None if not task.output_name else DynamicDataset(shmid(job_id, task.output_name.dataset_id), task.output_class)
			payload = ExecutionPayload(
				entrypoint=task.entrypoint,
				func=task.func,
				output=output,
				st_kwargs=task.static_params_kw,
				st_args=task.static_params_ps,
				dn_kwargs={
					param: DynamicDataset(
						shmid(job_id, dsid.dataset_id),
						task.classes_inputs_kw[param],
					)
					for param, dsid in task.dataset_inputs_kw.items()
				},
				dn_args={
					idx: DynamicDataset(
						shmid(job_id, dsid.dataset_id),
						task.classes_inputs_ps[idx],
					)
					for idx, dsid in task.dataset_inputs_ps.items()
				},
				environment=task.environment,
			)

			logger.debug(f"running task {task.name} in {job_id=}")
			ex_src, ex_snk = Pipe(duplex=False)
			task_process = Process(
				target=task_entrypoint,
				args=(
					payload,
					ExecutionContext(mem_db, ex_snk),
				),
			)
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

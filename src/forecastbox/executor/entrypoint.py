"""
The wrapper for executing ExecutableTaskInstance with various contexts
"""

# TODO unify this with worker/entrypoint

from typing import Callable, Any, Literal
import cascade.shm.client as shm_client
from forecastbox.executor.futures import DataFuture
from cascade.controller.api import ExecutableTaskInstance
from cascade.low.core import TaskDefinition
from contextlib import AbstractContextManager
from multiprocessing.connection import Connection
from forecastbox.worker.environment_manager import Environment
from forecastbox.worker.entrypoint import ExceptionReporter
import forecastbox.worker.serde as serde
from forecastbox.utils import logging_config, ensure, maybe_head
import logging
import importlib

logger = logging.getLogger(__name__)


def get_callable(task: TaskDefinition) -> Callable:
	if task.func is not None:
		return TaskDefinition.func_dec(task.func)
	elif task.entrypoint is not None:
		module_name, function_name = task.entrypoint.rsplit(".", 1)
		module = importlib.import_module(module_name)
		return module.__dict__[function_name]
	else:
		raise TypeError("neither entrypoint nor func given")


class ExecutionMemoryManager(AbstractContextManager):
	"""Handles opening and closing of SharedMemory objects, including their SerDe, within single task execution"""

	# TODO this should somehow merge with the shmdb

	mems: dict[str, shm_client.AllocatedBuffer]

	def __init__(self) -> None:
		self.mems: dict[str, shm_client.AllocatedBuffer] = {}

	def get(self, shmid: str, annotation: str) -> Any:
		if shmid not in self.mems:
			logger.debug(f"opening dataset {shmid}")
			self.mems[shmid] = shm_client.get(shmid)
		raw = self.mems[shmid].view()
		rv = serde.from_bytes(raw, annotation)
		logger.debug(f"deser into {annotation} done")
		return rv

	def put(self, data: Any, shmid: str, annotation: str) -> None:
		result_ser = serde.to_bytes(data, annotation)
		l = len(result_ser)
		rbuf = shm_client.allocate(shmid, l)
		rbuf.view()[:l] = result_ser
		rbuf.close()

	def __exit__(self, exc_type, exc_val, exc_tb) -> Literal[False]:
		for mem in self.mems.values():
			mem.close()
		return False


def entrypoint(task: ExecutableTaskInstance, ex_pipe: Connection) -> None:
	environment = task.task.definition.environment
	with ExceptionReporter(ex_pipe), Environment(environment), ExecutionMemoryManager() as mems:
		logging.config.dictConfig(logging_config)

		args: list[Any] = []
		for idx, arg in task.task.static_input_ps.items():
			ensure(args, idx)
			args[idx] = arg
		kwargs: dict[str, Any] = {}
		kwargs.update(task.task.static_input_kw)
		for wiring in task.wirings:
			shmid = DataFuture(taskName=wiring.sourceTask, outputName=wiring.sourceOutput).asShmId()
			if wiring.intoPosition is not None:
				ensure(args, wiring.intoPosition)
				args[wiring.intoPosition] = mems.get(shmid, wiring.annotation)
			if wiring.intoKwarg is not None:
				kwargs[wiring.intoKwarg] = mems.get(shmid, wiring.annotation)

		logger.debug(f"running {task.name} with {args=} and {kwargs=}")
		kallable = get_callable(task.task.definition)
		result = kallable(*args, **kwargs)

		if len(task.task.definition.output_schema) > 1:
			raise NotImplementedError("multiple outputs not supported yet")
		output_key = maybe_head(task.task.definition.output_schema.keys())
		if output_key is not None:
			shmid = DataFuture(task.name, output_key).asShmId()
			mems.put(result, shmid, task.task.definition.output_schema[output_key])
		del result

		# this is required so that the Shm can be properly freed
		# if you ever get 'pointers cannot be closed' bug, deleting args[i] individually etc
		del args
		del kwargs

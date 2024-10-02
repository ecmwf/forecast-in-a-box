"""
The wrapper for executing ExecutableTaskInstance with various contexts
"""

# TODO unify this with worker/entrypoint

import time
from typing import Callable, Any, Literal
from forecastbox.executor.futures import DataFuture
from cascade.controller.api import ExecutableTaskInstance
from cascade.low.core import TaskDefinition
from multiprocessing.shared_memory import SharedMemory
from multiprocessing.managers import DictProxy
from contextlib import AbstractContextManager
from multiprocessing.connection import Connection
from forecastbox.worker.environment_manager import Environment
from forecastbox.worker.entrypoint import ExceptionReporter
from forecastbox.worker.db import shm_worker_close
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

	mems: dict[str, SharedMemory]

	def __init__(self, shmdb: DictProxy) -> None:
		self.mems: dict[str, SharedMemory] = {}
		self.shmdb = shmdb

	def get(self, shmid: str, annotation: str) -> Any:
		tries = 0
		while tries < 3:
			if shmid not in self.shmdb:
				# the memory manager dict does not synchronize fast enough
				logger.error(f"didnt find {shmid}, sleeping")
				time.sleep(0.1)
				tries += 1
			else:
				break
		if shmid not in self.shmdb:
			raise ValueError(f"attempted to open non-registered dataset {shmid}")
		if shmid not in self.mems:
			logger.debug(f"opening dataset {shmid}")
			self.mems[shmid] = SharedMemory(name=shmid, create=False)
		raw = self.mems[shmid].buf[: self.shmdb[shmid]]
		return serde.from_bytes(raw, annotation)

	def put(self, data: Any, shmid: str, annotation: str) -> None:
		result_ser = serde.to_bytes(data, annotation)
		L = len(result_ser)
		logger.debug(f"storing result of len {L} as {shmid}")
		mem = SharedMemory(name=shmid, create=True, size=L)
		mem.buf[:L] = result_ser
		shm_worker_close(mem)
		self.shmdb[shmid] = L
		logger.debug(f"stored result of len {L} as {shmid}")

	def __exit__(self, exc_type, exc_val, exc_tb) -> Literal[False]:
		for key, mem in self.mems.items():
			mem.buf.release()
			shm_worker_close(mem)
		return False


def entrypoint(task: ExecutableTaskInstance, ex_pipe: Connection, shmdb: DictProxy) -> None:
	environment = task.task.definition.environment
	with ExceptionReporter(ex_pipe), Environment(environment), ExecutionMemoryManager(shmdb) as mems:
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
		for wiring in task.wirings:
			if wiring.intoPosition is not None:
				del args[wiring.intoPosition]
			if wiring.intoKwarg is not None:
				del kwargs[wiring.intoKwarg]

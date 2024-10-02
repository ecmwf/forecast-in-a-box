"""
Spawns new procesess and keeps track of them
"""

from typing import Iterable
from cascade.controller.api import ExecutableTaskInstance
from forecastbox.db import KVStore, KVStorePyrsistent
from multiprocessing.connection import wait
from multiprocessing import Process, Pipe
from dataclasses import dataclass
from multiprocessing.connection import Connection
from forecastbox.executor.entrypoint import entrypoint
from multiprocessing.managers import DictProxy
from forecastbox.executor.futures import TaskFuture
import logging

logger = logging.getLogger(__name__)


@dataclass
class ProcessHandle:
	p: Process
	e: Connection


class ProcWatch:
	def __init__(self) -> None:
		self.p: KVStore[ProcessHandle] = KVStorePyrsistent()

	def spawn(self, task: ExecutableTaskInstance, shmdb: DictProxy) -> str:
		ex_snk, ex_src = Pipe(duplex=False)
		p = Process(target=entrypoint, kwargs={"task": task, "ex_pipe": ex_src, "shmdb": shmdb})
		f = TaskFuture(taskName=task.name)
		self.p.update(f.asProcId(), ProcessHandle(p=p, e=ex_snk))
		logger.debug(f"about to start {task.name}, with shmdb state {shmdb.keys()}")
		p.start()
		return f.asCtrlId()

	def _get(self, procId: str) -> ProcessHandle:
		h = self.p.get(procId)
		if not h:
			raise KeyError(procId)
		return h

	def wait_some(self, procIds: Iterable[str], timeout_sec: int | None) -> set[str]:
		# TODO join, report exceptions
		sentinels = [self._get(e).p.sentinel for e in procIds]
		rv = wait(sentinels, timeout_sec)
		logger.debug(f"wait some returned with {rv}")
		return set(e for e in procIds if self._get(e).p.exitcode is not None)

	def is_done(self, procId: str) -> bool:
		return self._get(procId).p.exitcode is not None

	def join(self) -> None:
		# TODO lock?
		for k, h in self.p.all():
			h.p.join()
			if h.p.exitcode != 0:
				logger.error(f"process {h} failed: {h.p.exitcode}")
				# TODO log exception from h.e
		self.p = KVStorePyrsistent()

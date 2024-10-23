"""
Spawns new procesess and keeps track of them

This is basically ProcessPoolExecutor, but with a bit different api
for more control on queueing/reporting, and with process lifetime
spanning only single task.
"""

from typing import Iterable
from cascade.controller.api import ExecutableSubgraph
from multiprocessing.connection import wait
from multiprocessing import Process, Pipe
from dataclasses import dataclass
from multiprocessing.connection import Connection
from forecastbox.executor.entrypoint import entrypoint
import logging
from enum import Enum

logger = logging.getLogger(__name__)


class Status(int, Enum):
	enqueued = 0
	running = 1
	succeeded = 2
	failed = 3


@dataclass
class ProcessHandle:
	p: Process
	e: Connection


class ProcWatch:
	def __init__(self, size: int) -> None:
		self.running: dict[int, ProcessHandle] = {}
		self.status: dict[int, Status] = {}
		self.subgraphs: dict[int, ExecutableSubgraph] = {}
		self.exit_codes: dict[int, int] = {}
		self.last_inserted = -1
		self.first_enqueued = 0
		self.size = size

	def submit(self, subgraph: ExecutableSubgraph) -> int:
		"""May run if capacity, otherwise just enqueues and returns procId"""
		self.last_inserted += 1  # we could have gone with uuid, but not really needed
		self.status[self.last_inserted] = Status.enqueued
		self.subgraphs[self.last_inserted] = subgraph
		self.spawn_available()
		return self.last_inserted

	def spawn_available(self) -> None:
		"""Spawns new processes until `size` of them running / none enqueued"""
		logger.debug(f"checking spawn available with {self.first_enqueued=}, {self.last_inserted=}, and {len(self.running)=}")
		while self.first_enqueued <= self.last_inserted:
			if self.status[self.first_enqueued] != Status.enqueued:
				self.first_enqueued += 1
				continue
			if len(self.running) >= self.size:
				break
			handle = self.spawn(self.subgraphs.pop(self.first_enqueued))
			self.running[self.first_enqueued] = handle
			self.status[self.first_enqueued] = Status.running
			self.first_enqueued += 1

	def spawn(self, subgraph: ExecutableSubgraph) -> ProcessHandle:
		ex_snk, ex_src = Pipe(duplex=False)
		p = Process(target=entrypoint, kwargs={"subgraph": subgraph, "ex_pipe": ex_src})
		logger.debug(f"about to start {subgraph=}")
		p.start()
		if not p.pid:
			raise ValueError(f"failed to spawn a process for {subgraph=}")
		return ProcessHandle(p, ex_snk)

	def wait_some(self, procIds: Iterable[int], timeout_sec: int | None) -> set[int]:
		"""Checks whether given have finished, freeing up capacity to run more and possibly spawning enqueued ones"""
		statuses = {pid: self.status[pid] for pid in procIds}
		logger.debug(f"wait some with {statuses=}")
		if done := {k for k, v in statuses.items() if v in {Status.succeeded, Status.failed}}:
			return done
		if running := {k for k, v in statuses.items() if v in {Status.running}}:
			sentinels = [self.running[k].p.sentinel for k in running]
			rv1 = wait(sentinels, timeout_sec)  # we ignore rv1 because more may have finished
			logger.debug(f"wait some returned with {rv1}")
			rv2: set[int] = set()
			for k in running:
				if (ex := self.running[k].p.exitcode) is not None:
					# TODO report exceptions from pipe, join?
					rv2.add(k)
					self.exit_codes[k] = ex
					self.running.pop(k)
					self.status[k] = Status.succeeded if ex == 0 else Status.failed
			self.spawn_available()
			return rv2
		raise ValueError("nothing running!")

	def is_done(self, procId: int) -> bool:
		ex = self.exit_codes.get(procId, None)
		if ex is None:
			return False
		if ex != 0:
			raise ValueError(f"{procId=} failed with exit code {ex}")
		return True

	def join(self) -> None:
		for k, h in self.running.items():
			h.p.join()
			if h.p.exitcode != 0:
				logger.error(f"process {h} failed: {h.p.exitcode}")
				# TODO log exception from h.e
		self.running = {}

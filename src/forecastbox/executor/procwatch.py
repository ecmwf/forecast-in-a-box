"""
Spawns new procesess and keeps track of them

This is basically ProcessPoolExecutor, but with a bit different api
for more control on queueing/reporting, and with process lifetime
spanning only single task.
"""

from typing import cast
from cascade.executors.dask_futures import ExecutableSubgraph
from multiprocessing.connection import wait
from multiprocessing import Process, get_context
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
		self.subgraphs: dict[int, tuple[ExecutableSubgraph, dict[str, str]]] = {}
		self.exit_codes: dict[int, int] = {}
		self.last_inserted = -1
		self.first_enqueued = 0
		self.size = size

	def submit(self, subgraph: ExecutableSubgraph, tracingCtx: dict[str, str]) -> int:
		"""May run if capacity, otherwise just enqueues and returns procId"""
		self.last_inserted += 1  # we could have gone with uuid, but not really needed
		self.status[self.last_inserted] = Status.enqueued
		self.subgraphs[self.last_inserted] = (subgraph, tracingCtx)
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
			handle = self.spawn(*self.subgraphs.pop(self.first_enqueued))
			self.running[self.first_enqueued] = handle
			self.status[self.first_enqueued] = Status.running
			self.first_enqueued += 1

	def spawn(self, subgraph: ExecutableSubgraph, tracingCtx: dict[str, str]) -> ProcessHandle:
		ctx = get_context("fork")  # so far works, but switch to forkspawn if not
		ex_snk, ex_src = ctx.Pipe(duplex=False)
		p = ctx.Process(target=entrypoint, kwargs={"subgraph": subgraph, "ex_pipe": ex_src, "tracingCtx": tracingCtx})
		logger.debug(f"about to start {subgraph=}")
		p.start()
		if not p.pid:
			raise ValueError(f"failed to spawn a process for {subgraph=}")
		return ProcessHandle(cast(Process, p), ex_snk)

	def wait_some(self, timeout_sec: int | None) -> tuple[list[int], list[int]]:
		"""Checks whether given have finished, freeing up capacity to run more and possibly spawning enqueued ones"""
		running = list(self.running.keys())
		if not running:
			return [], []
		sentinels = [self.running[k].p.sentinel for k in running]
		logger.debug(f"wait for {running=}")
		_ = wait(sentinels, timeout_sec)
		ok: list[int] = list()
		fail: list[int] = list()

		for k in running:
			if (ex := self.running[k].p.exitcode) is not None:
				# TODO report exceptions from pipe, join?
				self.exit_codes[k] = ex
				self.running.pop(k)
				if ex == 0:
					ok.append(k)
					self.status[k] = Status.succeeded
				else:
					fail.append(k)
					self.status[k] = Status.failed
		self.spawn_available()
		return ok, fail

	def join(self) -> None:
		for k, h in self.running.items():
			h.p.join()
			if h.p.exitcode != 0:
				logger.error(f"process {h} failed: {h.p.exitcode}")
				# TODO log exception from h.e
		self.running = {}

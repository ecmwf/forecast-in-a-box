"""
The executor protocol itself

Notes:
 - single host only
 - data interchange is done via shared memory
"""

from typing import Any

from cascade.controller.api import ExecutableSubgraph
from cascade.low.core import Environment, Host
from cascade.low.func import assert_never
import cascade.shm.client as shm_client
import cascade.shm.api as shm_api

from forecastbox.executor.procwatch import ProcWatch
from forecastbox.executor.futures import TaskFuture, DataFuture, ctrl_id2future


class SingleHostExecutor:
	def __init__(self):
		self.procwatch = ProcWatch()

	def _validate_hosts(self, hosts: set[str]) -> None:
		if extra := hosts - {"worker"}:
			raise ValueError(f"unknown workers: {extra}")

	def get_environment(self) -> Environment:
		return Environment(hosts={"worker": Host(memory_mb=1, cpu=1, gpu=0)})  # TODO get the memory right

	def run_at(self, subgraph: ExecutableSubgraph, host: str) -> str:
		self._validate_hosts({host})
		return self.procwatch.spawn(subgraph)

	def scatter(self, taskName: str, outputName: str, hosts: set[str]) -> str:
		self._validate_hosts(hosts)
		return DataFuture(taskName=taskName, outputName=outputName).asCtrlId()

	def purge(self, taskName: str, outputName: str, hosts: set[str] | None = None) -> None:
		self._validate_hosts(hosts if hosts else set())
		shm_client.purge(DataFuture(taskName=taskName, outputName=outputName).asShmId())

	def fetch_as_url(self, taskName: str, outputName: str) -> str:
		return DataFuture(taskName, outputName).asUrl()

	def fetch_as_value(self, taskName: str, outputName: str) -> Any:
		return shm_client.get(DataFuture(taskName=taskName, outputName=outputName).asShmId())

	def wait_some(self, ids: set[str], timeout_sec: int | None = None) -> set[str]:
		futs = [ctrl_id2future(e) for e in ids]
		tasks = (e.asProcId() for e in futs if isinstance(e, TaskFuture))
		r1 = set(TaskFuture.fromProcId(e).asCtrlId() for e in self.procwatch.wait_some(tasks, timeout_sec))
		r2 = set(e.asCtrlId() for e in futs if isinstance(e, DataFuture) and shm_client.status(e.asShmId()) == shm_api.DatasetStatus.ready)
		return r1.union(r2)

	def is_done(self, id_: str) -> bool:
		fut = ctrl_id2future(id_)
		if isinstance(fut, DataFuture):
			return shm_client.status(fut.asShmId()) == shm_api.DatasetStatus.ready
		elif isinstance(fut, TaskFuture):
			return self.procwatch.is_done(fut.asProcId())
		else:
			assert_never(fut)

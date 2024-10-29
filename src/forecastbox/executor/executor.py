"""
The executor protocol itself

Notes:
 - single host only
 - data interchange is done via shared memory
"""

from dataclasses import dataclass
from typing import Any
import logging

from cascade.low.core import Environment, Worker, JobInstance, DatasetId
from cascade.low.views import param_source
from cascade.controller.core import Event, ActionDatasetTransmit, ActionSubmit, ActionDatasetPurge, WorkerId
from cascade.executors.dask_futures import build_subgraph
from cascade.executors.instant import SimpleEventQueue
import cascade.shm.client as shm_client

from forecastbox.executor.procwatch import ProcWatch
from forecastbox.executor.futures import DataFuture

logger = logging.getLogger(__name__)


@dataclass
class Config:
	process_count: int
	mbs_per_process: int  # for capacity allocation purposes, not really tracked

	def worker_name(self, i: int) -> str:
		return f"worker{i}"

	def to_env(self) -> Environment:
		return Environment(
			workers={self.worker_name(i): Worker(memory_mb=self.mbs_per_process, cpu=1, gpu=0) for i in range(self.process_count)}
		)


class SingleHostExecutor:
	def __init__(self, config: Config, job: JobInstance):
		self.config = config
		self.procwatch = ProcWatch(self.config.process_count)
		self.eq = SimpleEventQueue()
		self.job = job
		self.param_source = param_source(job.edges)
		self.fid2action: dict[int, ActionSubmit] = {}

	def _validate_workers(self, workers: set[str]) -> None:
		if extra := workers - set(self.config.to_env().workers):
			raise ValueError(f"unknown workers: {extra}")

	def get_environment(self) -> Environment:
		return self.config.to_env()

	def submit(self, action: ActionSubmit) -> None:
		self._validate_workers({action.at})
		# NOTE we ignore the host assignment because the hosts are ~equivalent
		subgraph = build_subgraph(action, self.job, self.param_source)
		id_ = self.procwatch.submit(subgraph)
		self.fid2action[id_] = action

	def transmit(self, action: ActionDatasetTransmit) -> None:
		# no-op because single shm
		self._validate_workers(set(action.fr + action.to))
		self.eq.transmit_done(action)

	def purge(self, action: ActionDatasetPurge) -> None:
		self._validate_workers(set(action.at))
		for ds in action.ds:
			shm_client.purge(DataFuture.fromDsId(ds).asShmId())

	def fetch_as_url(self, worker: WorkerId, dataset_id: DatasetId) -> str:
		return DataFuture.fromDsId(dataset_id).asUrl()

	def fetch_as_value(self, worker: WorkerId, dataset_id: DatasetId) -> Any:
		return shm_client.get(DataFuture.fromDsId(dataset_id).asShmId())

	def store_value(self, worker: WorkerId, dataset_id: DatasetId, data: bytes) -> None:
		shmid = DataFuture.fromDsId(dataset_id).asShmId()
		l = len(data)
		rbuf = shm_client.allocate(shmid, l)
		rbuf.view()[:l] = data
		rbuf.close()

	def wait_some(self, timeout_sec: int | None = None) -> list[Event]:
		if self.eq.any():
			return self.eq.drain()

		ok, finished = self.procwatch.wait_some(timeout_sec)
		for e in finished:
			logger.error(f"future {e} corresponding to {self.fid2action[e]} failed")
			raise ValueError(e)
		for e in ok:
			self.eq.submit_done(self.fid2action.pop(e))
		return self.eq.drain()

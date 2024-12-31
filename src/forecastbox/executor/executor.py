"""
The executor protocol itself

Notes:
 - single host only
 - data interchange is done via shared memory
"""

from dataclasses import dataclass
from typing import Any, Callable
import logging
from threading import Condition

from cascade.low.core import Environment, Worker, JobInstance, DatasetId, WorkerId
from cascade.low.views import param_source
from cascade.controller.core import ActionDatasetTransmit, ActionSubmit, ActionDatasetPurge, Event, DatasetStatus
from cascade.executors.dask_futures import build_subgraph
from cascade.executors.instant import SimpleEventQueue
import cascade.shm.client as shm_client
from cascade.low.tracing import mark, label, TaskLifecycle, TransmitLifecycle

from forecastbox.executor.procwatch import ProcWatch
from forecastbox.executor.futures import DataFuture

logger = logging.getLogger(__name__)


@dataclass
class Config:
	process_count: int
	mbs_per_process: int  # for capacity allocation purposes, not really tracked
	host_id: str

	def worker_name(self, i: int) -> WorkerId:
		return WorkerId(f"{self.host_id}", f"w{i}")

	def to_env(self) -> Environment:
		return Environment(
			workers={self.worker_name(i): Worker(memory_mb=self.mbs_per_process, cpu=1, gpu=0) for i in range(self.process_count)},
		)


class SingleHostExecutor:
	def __init__(self, config: Config, job: JobInstance):
		self.config = config
		self.procwatch = ProcWatch(self.config.process_count)
		self.eq = SimpleEventQueue()
		self.job = job
		self.param_source = param_source(job.edges)
		self.fid2action: dict[int, ActionSubmit] = {}
		label("host", config.host_id)
		self.lock = Condition()

	def get_environment(self) -> Environment:
		return self.config.to_env()

	def submit(self, action: ActionSubmit) -> None:
		logger.debug(f"acquiring lock on {action=}")
		self.lock.acquire()
		try:
			logger.debug(f"acquired lock on {action=}")
			# NOTE we ignore the host assignment because the hosts are ~equivalent
			subgraph = build_subgraph(action, self.job, self.param_source)
			for task in subgraph.tasks:
				mark({"task": task.name, "action": TaskLifecycle.enqueued, "worker": repr(action.at)})
			id_ = self.procwatch.submit(subgraph, {"worker": repr(action.at)})
			self.fid2action[id_] = action
		finally:
			logger.debug("about to notify on condition")
			self.lock.notify()
			logger.debug("about to release on condition")
			self.lock.release()

	def transmit(self, action: ActionDatasetTransmit) -> None:
		# no-op because single shm
		self.eq.transmit_done(action)
		for worker in action.to:
			for dataset in action.ds:
				mark({"dataset": dataset.task, "action": TransmitLifecycle.received, "worker": repr(worker), "mode": "local"})
				mark({"dataset": dataset.task, "action": TransmitLifecycle.unloaded, "worker": repr(worker), "mode": "local"})

	def purge(self, action: ActionDatasetPurge) -> None:
		for ds in action.ds:
			shm_client.purge(DataFuture.fromDsId(ds).asShmId())

	def fetch_as_url(self, worker: WorkerId, dataset_id: DatasetId) -> str:
		return DataFuture.fromDsId(dataset_id).asUrl()

	def fetch_as_value(self, dataset_id: DatasetId) -> Any:
		return shm_client.get(DataFuture.fromDsId(dataset_id).asShmId())

	def store_value(self, worker: WorkerId, dataset_id: DatasetId, data: bytes) -> None:
		mark({"dataset": dataset_id.task, "action": TransmitLifecycle.received, "target": repr(worker)})
		logger.debug(f"acquiring lock on store value {dataset_id=} {worker=}")
		self.lock.acquire()
		try:
			logger.debug(f"acquired lock on store value {dataset_id=} {worker=}")
			shmid = DataFuture.fromDsId(dataset_id).asShmId()
			l = len(data)
			try:
				rbuf = shm_client.allocate(shmid, l)
			except Exception:
				# NOTE this branch is for situations where the controller issued redundantly two transmits
				# TODO check that the exception is truly a Conflict, or even better, remove this branch altogether
				mark({"dataset": dataset_id.task, "action": TransmitLifecycle.unloaded, "target": repr(worker), "mode": "redundant"})
				logger.exception(f"store of {dataset_id} failed, presumably already computed")
			else:
				rbuf.view()[:l] = data
				rbuf.close()
				mark({"dataset": dataset_id.task, "action": TransmitLifecycle.unloaded, "target": repr(worker), "mode": "remote"})
			event = Event(at=worker, ts_trans=[], ds_trans=[(dataset_id, DatasetStatus.available)])
			for callback in self.procwatch.event_callbacks:
				callback(event)
			self.procwatch.available_datasets.add(dataset_id)
			self.procwatch.spawn_available()
		except Exception as ex:
			event = Event(failures=[f"data transmit of {dataset_id} failed with {repr(ex)}"], at=worker)
			for callback in self.procwatch.event_callbacks:
				callback(event)
		finally:
			logger.debug("about to notify on condition")
			self.lock.notify()
			logger.debug("about to release on condition")
			self.lock.release()

	def shutdown(self) -> None:
		self.procwatch.join()

	def wait_some(self, timeout_sec: int | None = None) -> list[Event]:
		logger.debug("acquiring lock on wait_some")
		self.lock.acquire()
		try:
			logger.debug("acquired lock on wait_some")
			if self.eq.any():
				return self.eq.drain()

			ok, finished = self.procwatch.wait_some(timeout_sec, self.lock)
			for e in finished:
				# TODO read exception, propagate
				logger.error(f"future {e} corresponding to {self.fid2action[e]} failed")
				self.eq.submit_failed(self.fid2action.pop(e))
			for e in ok:
				self.eq.submit_done(self.fid2action.pop(e))
			return self.eq.drain()
		finally:
			logger.debug("about to notify on condition")
			self.lock.notify()
			logger.debug("about to release on condition")
			self.lock.release()

	def register_event_callback(self, callback: Callable[[Event], None]) -> None:
		self.procwatch.event_callbacks.append(callback)

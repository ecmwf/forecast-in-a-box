"""
In-memory state for the worker to keep track of shared memory and processes
"""

# TODO introduce some locks

from multiprocessing.managers import SyncManager
from dataclasses import dataclass
from multiprocessing import Process, connection
from multiprocessing.shared_memory import SharedMemory
from typing import cast, Iterator
import logging
import multiprocessing.resource_tracker as resource_tracker

logger = logging.getLogger(__name__)


def shm_worker_close(shm: SharedMemory):
	"""When a shm object is created, it is registered by the resource tracker. At the end of the process's lifecycle,
	all registered resources are cleaned up using that type's function. For shm, this means calling unlink -- which is
	very undesirable, because we expect a/ other process to still be able to access that b/ main process to call
	unlink at its end. However, just calling `close` on shm does not cause it to unregister, so we have to unregister
	manually. We don't need to call this in the main (ie, non-worker) process, because there we unlink (which happens
	to unregister)."""
	logger.debug(f"closing worker's shm {shm.name}")
	resource_tracker.unregister(shm._name, "shared_memory")  # type: ignore # _name is private
	shm.close()


class MemDb:
	def __init__(self, m: SyncManager) -> None:
		self.memory: dict[str, int] = cast(dict[str, int], m.dict())

	def data_stream(self, data_id: str) -> Iterator[bytes]:
		if (L := self.memory.get(data_id, -1)) < 0:
			raise KeyError(f"{data_id=} not present")
		m = SharedMemory(name=data_id, create=False)
		i = 0
		block_len = 1024
		while i < L:
			yield bytes(m.buf[i : min(L, i + block_len)])
			i += block_len
		m.close()

	def close_all(self):
		for k in self.memory:
			m = SharedMemory(name=k, create=False)
			m.close()
			m.unlink()

	# TODO consider moving some logic from entrypoints in here


class JobDb:
	def __init__(self) -> None:
		self.jobs: dict[str, Process] = {}

	def submit(self, job_id: str, p: Process) -> bool:
		self.jobs[job_id] = p
		self.jobs[job_id].start()
		return True


@dataclass
class DbContext:
	mem_db: MemDb
	job_db: JobDb

	def wait_all(self) -> None:
		if self.job_db.jobs:
			connection.wait(p.sentinel for p in self.job_db.jobs.values())
		self.mem_db.close_all()
		# TODO join/kill spawned processes

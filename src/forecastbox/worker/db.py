"""
In-memory state for the worker to keep track of shared memory and processes
"""

# TODO introduce some locks

from multiprocessing.managers import SyncManager
from dataclasses import dataclass
from multiprocessing import Process, connection
from multiprocessing.shared_memory import SharedMemory
from typing import cast, Iterator


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
		for k in self.mem_db.memory:
			m = SharedMemory(name=k, create=False)
			m.close()
			m.unlink()
		# TODO join/kill spawned processes

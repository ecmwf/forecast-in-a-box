"""
Keeps track of what shared memory has been registerd
"""

import logging
from multiprocessing.shared_memory import SharedMemory
from multiprocessing.managers import DictProxy
from typing import Iterator

logger = logging.getLogger(__name__)


def _unlink_shm(shmid: str):
	m = SharedMemory(name=shmid, create=False)
	m.close()
	m.unlink()


class ShmDb:
	"""Just a wrapper around the shared object, which holds shm->len mappings"""

	def __init__(self, d: DictProxy) -> None:
		self.d = d

	def stream(self, shmid: str) -> Iterator[bytes]:
		if (L := self.d.get(shmid, -1)) < 0:
			raise KeyError(f"{shmid=} not present")
		m = SharedMemory(name=shmid, create=False)
		i = 0
		block_len = 1024
		while i < L:
			yield bytes(m.buf[i : min(L, i + block_len)])
			i += block_len
		m.close()

	def purge(self, shmid: str) -> None:
		self.d.pop(shmid)
		_unlink_shm(shmid)

	def purge_all(self):
		# TODO lock?
		keys = self.d.keys()
		for shmid in keys:
			_unlink_shm(shmid)
			self.d.pop(shmid)

	def contains(self, shmid: str) -> bool:
		return shmid in self.d

	@staticmethod
	def put(d: DictProxy, key: str, b: bytes) -> None:
		L = len(b)
		logger.debug(f"storing result of len {L} as {key}")
		mem = SharedMemory(name=key, create=True, size=L)
		mem.buf[:L] = b
		mem.close()
		d[key] = L
		logger.debug(f"stored result of len {L} as {key}")

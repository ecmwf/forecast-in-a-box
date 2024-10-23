"""
Ids for representation of future results. Most of the code is just serde and translations
"""

from typing import Optional
from dataclasses import dataclass
from typing_extensions import Self
import hashlib


@dataclass
class TaskFuture:
	# taskNames: list[str]
	pid: int

	def asCtrlId(self) -> str:
		return f"task-{self.pid}"

	@classmethod
	def fromCtrlId(cls, id_: str) -> Optional[Self]:
		if id_[:4] != "task":
			return None
		return cls(pid=int(id_[5:]))

	def asProcId(self) -> int:
		return self.pid

	@classmethod
	def fromProcId(cls, procId: int) -> Self:
		return cls(pid=procId)


@dataclass
class DataFuture:
	taskName: str
	outputName: str

	def asCtrlId(self) -> str:
		return f"data{len(self.taskName)}-{self.taskName}-{self.outputName}"

	@classmethod
	def fromCtrlId(cls, id_: str) -> Optional[Self]:
		if id_[:4] != "data":
			return None
		sfxH, sfxT = id_[4:].split("-", 1)
		return cls(taskName=sfxT[: int(sfxH)], outputName=sfxT[int(sfxH) + 1 :])

	def asShmId(self) -> str:
		# we cant use too long file names for shm, https://trac.macports.org/ticket/64806
		h = hashlib.new("md5", usedforsecurity=False)
		h.update((self.taskName + self.outputName).encode())
		return h.hexdigest()[:24]

	def asUrl(self) -> str:
		raise NotImplementedError


def ctrl_id2future(id_: str) -> DataFuture | TaskFuture:
	if df := DataFuture.fromCtrlId(id_):
		return df
	elif tf := TaskFuture.fromCtrlId(id_):
		return tf
	else:
		raise ValueError(id_)

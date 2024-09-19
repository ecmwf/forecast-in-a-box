"""
Support for automated serde for Task outputs and dynamic inputs
"""

from typing import Any, Protocol, runtime_checkable, Callable, Optional, Type, cast
from dataclasses import dataclass
import numpy as np
import cloudpickle
import logging

logger = logging.getLogger(__name__)


@runtime_checkable
class SerDer(Protocol):
	# NOTE this protocol exists for allowing pluggable implementations
	def to_bytes(self, v: Any) -> bytes:
		raise NotImplementedError

	def from_bytes(self, v: memoryview) -> Any:
		raise NotImplementedError


@dataclass
class SerDerDc:
	ser: Callable[[Any], bytes]
	des: Callable[[memoryview], Any]

	def to_bytes(self, v: Any) -> bytes:
		return self.ser(v)

	def from_bytes(self, v: memoryview) -> Any:
		return self.des(v)


# TODO this should be a plugin, not core part of fiab
def np_to_bytes(v: Any) -> bytes:
	arr = cast(np.ndarray, v)
	dtype = cloudpickle.dumps(arr.dtype)
	d_len = len(dtype).to_bytes(4, "big")
	shape = cloudpickle.dumps(arr.shape)
	s_len = len(shape).to_bytes(4, "big")
	return d_len + dtype + s_len + shape + arr.tobytes()


def np_from_bytes(v: memoryview) -> Any:
	d_len = int.from_bytes(v[:4], "big")
	dtype = cloudpickle.loads(v[4 : 4 + d_len])
	s_len = int.from_bytes(v[4 + d_len : 4 + d_len + 4])
	shape = cloudpickle.loads(v[4 + d_len + 4 : 4 + d_len + 4 + s_len])
	raw = np.frombuffer(v[4 + d_len + 4 + s_len :], dtype=dtype)
	return raw.reshape(shape)


registry: dict[str, SerDer] = {
	"bytes": SerDerDc(ser=lambda b: b, des=lambda b: b),
	"str": SerDerDc(ser=lambda s: s.encode("ascii"), des=lambda b: bytes(b).decode("ascii")),
	"int": SerDerDc(ser=lambda i: i.to_bytes(4, "big"), des=lambda b: int.from_bytes(b, "big")),
	"ndarray": SerDerDc(ser=np_to_bytes, des=np_from_bytes),
	"grib": SerDerDc(ser=lambda b: b, des=lambda b: b),  # TODO proper
}


def find_registry(klazz: Type | str) -> Optional[SerDer]:
	# TODO expose the pluggable protocols, dont forget isinstance check
	if isinstance(klazz, type):
		klazz_name = klazz.__name__
	else:
		klazz_name = klazz
	if klazz_name in registry:
		return registry[klazz_name]
	if isinstance(klazz, type):
		for base in klazz.__bases__:
			maybe = find_registry(base)
			if maybe is not None:
				return maybe
	return None


def to_bytes(v: Any, annotation: Optional[str] = None) -> bytes:
	klazz: str | Type
	if isinstance(v, bytes):
		# presumed to be untyped lambda / unsupported serde -> done on user level
		return v
	elif annotation is None:
		klazz = v.__class__
	else:
		klazz = annotation
	serder = find_registry(klazz)
	if not serder:
		raise ValueError(f"failed to serialize {v.__class__}")
	return serder.to_bytes(v)


def from_bytes(b: memoryview, annotation: str) -> Any:
	if annotation == "Any":
		# presumed to be untyped lambda / unsupported serde -> done on user level
		return b
	serder = find_registry(annotation)
	if not serder:
		raise ValueError(f"failed to deserialize {annotation}")
	return serder.from_bytes(b)

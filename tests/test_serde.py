from forecastbox.worker.serde import from_bytes, to_bytes
import numpy as np
import pytest


def test_basic_types():
	b = b"hello fiab"
	assert b == from_bytes(memoryview(to_bytes(b)), "bytes")
	s = "hello fiab"
	assert s == from_bytes(memoryview(to_bytes(s)), "str")
	i = 42
	assert i == from_bytes(memoryview(to_bytes(i)), "int")
	with pytest.raises(OverflowError):
		to_bytes(i << 31)
	with pytest.raises(ValueError):
		to_bytes([0])
	with pytest.raises(ValueError):
		from_bytes(memoryview(b""), "unknown class")

	# may have to be moved to 3rd party test
	a1 = np.array([1, 2, 3])
	a2 = np.array([[1.0, 2.0], [3.0, 4.0]])
	# the toreadonly is to ensure zero copy deser
	assert (a1 == from_bytes(memoryview(to_bytes(a1)).toreadonly(), "ndarray")).all()
	assert (a2 == from_bytes(memoryview(to_bytes(a2)).toreadonly(), "ndarray")).all()

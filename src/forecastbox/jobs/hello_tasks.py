import logging
import numpy as np

logger = logging.getLogger(__name__)


def entrypoint_step1(**kwargs) -> bytes:
	i1 = kwargs["start_date"].__hash__() % 16
	i2 = kwargs["end_date"].__hash__() % 16
	logger.info(f"got two numbers {i1} and {i2}")
	return np.array([i1, i2]).tobytes()


def entrypoint_step2(**kwargs) -> bytes:
	logger.debug(f"{kwargs=}")
	input_raw = kwargs["intermediate"]
	input_npy = np.frombuffer(input_raw, dtype=int, count=2)
	return (f"hello world from {input_npy}").encode()

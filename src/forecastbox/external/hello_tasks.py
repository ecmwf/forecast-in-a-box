import logging
import numpy as np

logger = logging.getLogger(__name__)


def entrypoint_step1(**kwargs) -> bytes:
	i1 = int(kwargs["adhocParam1"])
	i2 = int(kwargs["adhocParam2"])
	logger.info(f"got two numbers {i1} and {i2}")
	return np.array([i1, i2]).tobytes()


def entrypoint_step2(**kwargs) -> bytes:
	logger.debug(f"{kwargs=}")
	input_raw = kwargs["intertaskParam"]
	p3 = kwargs["adhocParam3"]
	input_npy = np.frombuffer(input_raw, dtype=int, count=2)
	return (f"hello world from {input_npy} and {p3}").encode()

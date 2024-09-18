import logging
import numpy as np

logger = logging.getLogger(__name__)


def entrypoint_step1(adhocParam1: int, adhocParam2: int) -> bytes:
	logger.info(f"got two numbers {adhocParam1} and {adhocParam2}")
	return np.array([adhocParam1, adhocParam2]).tobytes()


def entrypoint_step2(intertaskParam: memoryview, adhocParam3: str) -> bytes:
	input_npy = np.frombuffer(intertaskParam, dtype=int, count=2)
	return (f"hello world from {input_npy} and {adhocParam3}").encode()

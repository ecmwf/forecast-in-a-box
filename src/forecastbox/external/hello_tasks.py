import logging
import numpy as np

logger = logging.getLogger(__name__)


def entrypoint_step1(adhocParam1: int, adhocParam2: int) -> np.ndarray:
	logger.info(f"got two numbers {adhocParam1} and {adhocParam2}")
	return np.array([adhocParam1, adhocParam2])


def entrypoint_step2(intertaskParam: np.ndarray, adhocParam3: str) -> str:
	return f"hello world from {intertaskParam} and {adhocParam3}"

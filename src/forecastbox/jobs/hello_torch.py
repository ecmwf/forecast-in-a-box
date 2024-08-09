import torch
import logging
from typing import cast

logger = logging.getLogger(__name__)


def get_device() -> torch.device:
	if torch.cuda.device_count() > 0 and torch.cuda.is_available():
		dvc = "cuda"
	elif torch.mps.device_count() > 0:
		dvc = "mps"
	else:
		dvc = "cpu"

	logger.info(f"selected device type {dvc}")
	return torch.device(dvc)


def get_info() -> tuple[str, int]:
	if torch.cuda.device_count() > 0 and torch.cuda.is_available():
		return "cuda", -1
	elif torch.mps.device_count() > 0:
		return "mps", torch.mps.current_allocated_memory()
	else:
		return "cpu", -1


def torch_sum(i1: int, i2: int) -> tuple[int, str, int]:
	dvc = get_device()
	tf = lambda i: torch.tensor(i, dtype=torch.int8, device=dvc)
	t1 = tf(i1)
	t2 = tf(i2)
	tr = t1 + t2
	device_info = get_info()
	# funnily, tolist does not necessarily return a list
	return cast(int, tr.tolist()), *device_info


def entrypoint(**kwargs) -> bytes:
	b1 = (f"hello torch from {kwargs['start_date']} to {kwargs['end_date']}").encode()
	i1 = kwargs["start_date"].__hash__() % 16
	i2 = kwargs["end_date"].__hash__() % 16
	result = torch_sum(i1, i2)
	b2 = (f"\nresult of {i1} + {i2} is {result[0]}").encode()
	b3 = (f"\nwe used device {result[1]} with memory {result[2]}").encode()
	return b1 + b2 + b3

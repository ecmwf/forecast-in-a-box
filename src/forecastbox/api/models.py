import os

from typing import TYPE_CHECKING

if TYPE_CHECKING:
	from anemoi.inference.checkpoint import Checkpoint

MODEL_CHECKPOINT_PATH = os.getenv("FIAB_MODELS", "/tmp/fiab/models")
TESTING_LOOKUP = {
	"aifs-single": {"huggingface": "ecmwf/aifs-single-1.0"},
	"aifs-single-0.2.1": {"huggingface": "ecmwf/aifs-single-0.2.1"},
}


async def open_checkpoint(model_name: str) -> "Checkpoint":
	"""Open an anemoi checkpoint."""

	from anemoi.inference.checkpoint import Checkpoint

	if model_name in TESTING_LOOKUP:
		model_name = TESTING_LOOKUP[model_name]  # type: ignore
	else:
		model_name = os.path.join(MODEL_CHECKPOINT_PATH, model_name)

	return Checkpoint(model_name)
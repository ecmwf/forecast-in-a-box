"""
This module provides access to model artifacts. It can happen in multiple ways:
 - the models can be retrieved from the operating system fs during runtime (target: development)
 - the models can be packaged into the executable during build time (target: public models, prod usage)
 - the models can be remotely fetched during runtime (target: private models, prod usage)
"""

import os
import pathlib


def get_path(model_key: str) -> pathlib.Path:
	"""Just a wrapper to distinguish between in-package and in-venv regimes. Caller is expected to `load`
	on their own."""
	if "FIAB_MODEL_REPO" in os.environ:
		return pathlib.Path(os.environ["FIAB_MODEL_REPO"]) / model_key
	else:
		return pathlib.Path(__file__).parent / model_key

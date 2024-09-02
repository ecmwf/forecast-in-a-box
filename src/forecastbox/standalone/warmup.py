"""
Entrypoint for the uv cache warmup -- will populate the cache with all dependencies for currently known tasks
"""

from forecastbox.worker.environment_manager import prepare
from forecastbox.plugins.lookup import get_task
from forecastbox.api.common import RegisteredTask
import logging

logger = logging.getLogger(__name__)

if __name__ == "__main__":
	logging.basicConfig(level=logging.INFO)  # TODO replace with config

	for task in RegisteredTask:
		logger.info(f"warming up {task=}")
		tmpdir = prepare("warmup_job", get_task(task).environment)
		if tmpdir:
			tmpdir.cleanup()

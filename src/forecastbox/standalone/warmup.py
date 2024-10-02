"""
Entrypoint for the uv cache warmup -- will populate the cache with all dependencies for currently known tasks
"""

from forecastbox.worker.environment_manager import Environment
from forecastbox.plugins.lookup import get_task
from forecastbox.api.common import RegisteredTask
import logging
import logging.config
from forecastbox.utils import logging_config

logger = logging.getLogger(__name__)

if __name__ == "__main__":
	logging.config.dictConfig(logging_config)

	# TODO cover cascade as well
	for task in RegisteredTask:
		with Environment(get_task(task).environment.packages):
			logger.info(f"warming up {task=}")

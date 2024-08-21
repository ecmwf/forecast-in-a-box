"""
Translation of the job request into the actual code

We need to be a bit careful with imports here -- some of the dependencies
do quite a lot on import (like building font cache), so we don't want to load
them right away on the server start.
"""

from forecastbox.api.common import Task
import importlib

from typing import Callable


def get_process_target(task: Task) -> Callable:
	module_name, function_name = task.entrypoint.rsplit(".", 1)
	module = importlib.import_module(module_name)
	return module.__dict__[function_name]

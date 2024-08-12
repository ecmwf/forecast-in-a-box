from forecastbox.jobs.hello_world import entrypoint as hello_world
from forecastbox.jobs.hello_torch import entrypoint as hello_torch
from forecastbox.jobs.hello_image import entrypoint as hello_image
from forecastbox.api.common import TaskFunctionEnum
from forecastbox.utils import assert_never

from typing import Callable


def get_process_target(job_function: TaskFunctionEnum) -> Callable:
	match job_function:
		case TaskFunctionEnum.hello_world:
			return hello_world
		case TaskFunctionEnum.hello_torch:
			return hello_torch
		case TaskFunctionEnum.hello_image:
			return hello_image
		case s:
			assert_never(s)

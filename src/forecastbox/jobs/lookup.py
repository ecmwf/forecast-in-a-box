from forecastbox.jobs.hello_world import entrypoint as hello_world
from forecastbox.jobs.hello_torch import entrypoint as hello_torch
from forecastbox.api.common import JobFunctionEnum
from typing import Callable, NoReturn, Any


def assert_never(v: Any) -> NoReturn:
	raise TypeError(v)


def get_process_target(job_function: JobFunctionEnum) -> Callable:
	match job_function:
		case JobFunctionEnum.hello_world:
			return hello_world
		case JobFunctionEnum.hello_torch:
			return hello_torch
		case s:
			assert_never(s)

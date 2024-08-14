from forecastbox.jobs.hello_world import entrypoint as hello_world
from forecastbox.jobs.hello_torch import entrypoint as hello_torch
from forecastbox.jobs.hello_image import entrypoint as hello_image
import forecastbox.jobs.hello_tasks as hello_tasks
import forecastbox.jobs.hello_earth as hello_earth
import forecastbox.jobs.temperature_nbeats as tp_nb
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
		case TaskFunctionEnum.hello_tasks_step1:
			return hello_tasks.entrypoint_step1
		case TaskFunctionEnum.hello_tasks_step2:
			return hello_tasks.entrypoint_step2
		case TaskFunctionEnum.earthkit_querymars:
			return hello_earth.entrypoint_marsquery
		case TaskFunctionEnum.tp_nb_get:
			return tp_nb.get_data
		case TaskFunctionEnum.tp_nb_pred:
			return tp_nb.predict
		case s:
			assert_never(s)

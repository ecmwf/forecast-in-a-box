"""
Translation of the job request into the actual code

We need to be a bit careful with imports here -- some of the dependencies
do quite a lot on import (like building font cache), so we don't want to load
them right away on the server start.
"""

from forecastbox.api.common import TaskFunctionEnum
from forecastbox.utils import assert_never

from typing import Callable


def get_process_target(job_function: TaskFunctionEnum) -> Callable:
	match job_function:
		case TaskFunctionEnum.hello_world:
			from forecastbox.jobs.hello_world import entrypoint as hello_world

			return hello_world
		case TaskFunctionEnum.hello_torch:
			from forecastbox.jobs.hello_torch import entrypoint as hello_torch

			return hello_torch
		case TaskFunctionEnum.hello_image:
			from forecastbox.jobs.hello_image import entrypoint as hello_image

			return hello_image
		case TaskFunctionEnum.hello_tasks_step1:
			import forecastbox.jobs.hello_tasks as hello_tasks

			return hello_tasks.entrypoint_step1
		case TaskFunctionEnum.hello_tasks_step2:
			import forecastbox.jobs.hello_tasks as hello_tasks

			return hello_tasks.entrypoint_step2
		case TaskFunctionEnum.earthkit_querymars:
			import forecastbox.jobs.hello_earth as hello_earth

			return hello_earth.entrypoint_marsquery
		case TaskFunctionEnum.tp_nb_get:
			import forecastbox.jobs.temperature_nbeats as tp_nb

			return tp_nb.get_data
		case TaskFunctionEnum.tp_nb_pred:
			import forecastbox.jobs.temperature_nbeats as tp_nb

			return tp_nb.predict
		case TaskFunctionEnum.aifsl_pred:
			import forecastbox.jobs.hello_aifs as hello_aifs

			return hello_aifs.entrypoint_forecast
		case TaskFunctionEnum.aifsl_plot:
			import forecastbox.jobs.hello_aifs as hello_aifs

			return hello_aifs.entrypoint_plot
		case s:
			assert_never(s)

import logging
import uvicorn
import os
from multiprocessing import Process, connection, set_start_method, freeze_support


def setup_process(env_context: dict[str, str]):
	"""Invoke at the start of each new process. Configures logging etc"""
	logging.basicConfig(level=logging.INFO)
	os.environ.update(env_context)


def launch_web_ui(env_context: dict[str, str]):
	setup_process(env_context)
	port = int(env_context["FIAB_WEB_URL"].rsplit(":", 1)[1])
	uvicorn.run("forecastbox.web_ui.server:app", host="0.0.0.0", port=port, log_level="info", workers=1)


def launch_controller(env_context: dict[str, str]):
	setup_process(env_context)
	port = int(env_context["FIAB_CTR_URL"].rsplit(":", 1)[1])
	uvicorn.run("forecastbox.controller.server:app", host="0.0.0.0", port=port, log_level="info", workers=1)


if __name__ == "__main__":
	freeze_support()

	print("main process starting")
	set_start_method("forkserver")
	setup_process({})
	context = {
		"FIAB_WEB_URL": "http://localhost:8000",
		"FIAB_CTR_URL": "http://localhost:8001",
		"FIAB_WRK_URL": "http://localhost:8002",
	}

	controller = Process(target=launch_controller, args=(context,))
	controller.start()

	# TODO launch worker.server

	web_ui = Process(target=launch_web_ui, args=(context,))
	web_ui.start()

	# TODO check for status=ok of each service, then launch browser window
	connection.wait(
		(
			controller.sentinel,
			web_ui.sentinel,
		)
	)

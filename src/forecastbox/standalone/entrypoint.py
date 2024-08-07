import logging
import uvicorn
from multiprocessing import Process


def setup_process():
	"""Invoke at the start of each new process. Configures logging etc"""
	logging.basicConfig(level=logging.INFO)


def launch_web_ui():
	setup_process()
	uvicorn.run("forecastbox.web_ui.server:app", host="0.0.0.0", port=8000, log_level="info", workers=1)


if __name__ == "__main__":
	setup_process()
	# TODO launch the controller.server, worker.server, web_ui.server
	web_ui = Process(target=launch_web_ui)
	web_ui.start()

	web_ui.join()

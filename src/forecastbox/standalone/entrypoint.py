"""
Entrypoint for the standalone fiab execution (frontend, controller and worker spawned by a single process)
"""

import logging
import webbrowser
import time
import httpx
import uvicorn
import os
from multiprocessing import Process, connection, set_start_method, freeze_support


logger = logging.getLogger(__name__)


def setup_process(env_context: dict[str, str]):
	"""Invoke at the start of each new process. Configures logging etc"""
	logging.basicConfig(level=logging.INFO)  # TODO replace with config
	os.environ.update(env_context)


def uvicorn_run(app_name: str, port: int) -> None:
	# NOTE we pass None to log config to not interfere with original logging setting
	config = uvicorn.Config(
		app_name,
		port=port,
		host="0.0.0.0",
		log_config=None,
		log_level=None,
		workers=1,
	)
	server = uvicorn.Server(config)
	server.run()


def launch_frontend(env_context: dict[str, str]):
	setup_process(env_context)
	port = int(env_context["FIAB_WEB_URL"].rsplit(":", 1)[1])
	uvicorn_run("forecastbox.frontend.server:app", port)


def launch_controller(env_context: dict[str, str]):
	setup_process(env_context)
	port = int(env_context["FIAB_CTR_URL"].rsplit(":", 1)[1])
	uvicorn_run("forecastbox.controller.server:app", port)


def launch_worker(env_context: dict[str, str]):
	setup_process(
		{
			**env_context,
			**{"FIAB_WRK_MEM_MB": "2048"},  # doesnt really matter now
		}
	)
	port = int(env_context["FIAB_WRK_URL"].rsplit(":", 1)[1])
	uvicorn_run("forecastbox.worker.server:app", port)


def wait_for(client: httpx.Client, root_url: str) -> None:
	"""Calls /status endpoint, retry on ConnectError"""
	i = 0
	while i < 10:
		try:
			rc = client.get(f"{root_url}/status")
			if not rc.status_code == 200:
				raise ValueError(f"failed to start {root_url}: {rc}")
			return
		except httpx.ConnectError:
			i += 1
			time.sleep(2)
	raise ValueError(f"failed to start {root_url}: no more retries")


if __name__ == "__main__":
	freeze_support()
	set_start_method("forkserver")
	setup_process({})
	logger.info("main process starting")
	context = {
		"FIAB_WEB_URL": "http://localhost:8000",
		"FIAB_CTR_URL": "http://localhost:8001",
		"FIAB_WRK_URL": "http://localhost:8002",
	}

	controller = Process(target=launch_controller, args=(context,))
	controller.start()

	worker = Process(target=launch_worker, args=(context,))
	worker.start()

	frontend = Process(target=launch_frontend, args=(context,))
	frontend.start()

	with httpx.Client() as client:
		for root_url in context.values():
			wait_for(client, root_url)

	webbrowser.open(context["FIAB_WEB_URL"])

	connection.wait(
		(
			controller.sentinel,
			worker.sentinel,
			frontend.sentinel,
		)
	)

"""
Entrypoint for the standalone fiab execution (frontend, controller and worker spawned by a single process)
"""

import asyncio
import logging
import logging.config
import webbrowser
import time
import httpx
import uvicorn
import os

from multiprocessing import Process, connection, set_start_method, freeze_support
from forecastbox.utils import logging_config


logger = logging.getLogger(__name__ if __name__ != "__main__" else "forecastbox.standalone.entrypoint")


def setup_process(env_context: dict[str, str]):
	"""Invoke at the start of each new process. Configures logging etc"""
	logging.config.dictConfig(logging_config)
	os.environ.update(env_context)


async def uvicorn_run(app_name: str, port: int) -> None:
	# NOTE we pass None to log config to not interfere with original logging setting
	config = uvicorn.Config(
		app_name,
		port=port,
		host="0.0.0.0",
		log_config=None,
		log_level=None,
		workers=1,
		reload=True,
		reload_dirs=["backend/forecastbox"],
	)
	server = uvicorn.Server(config)
	await server.serve()

async def cascade_run(url: str) -> None:
	from cascade.gateway.server import serve
	serve(url)

def launch_api(env_context: dict[str, str]):
	setup_process(env_context)
	port = int(env_context["API_URL"].rsplit(":", 1)[1])
	try:
		asyncio.run(uvicorn_run("forecastbox.entrypoint:app", port))
	except KeyboardInterrupt:
		pass  # no need to spew stacktrace to log


def launch_cascade(env_context: dict[str, str]):
	setup_process(env_context)
	try:
		asyncio.run(cascade_run(env_context["CASCADE_URL"]))
	except KeyboardInterrupt:
		pass  # no need to spew stacktrace to log


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

	from forecastbox.settings import get_settings
	settings = get_settings()
	context = {
		"WEB_URL": settings.web_url,
		"API_URL": settings.api_url,
		"CASCADE_URL": settings.cascade_url,
	}

	cascade = Process(target=launch_cascade, args=(context,))
	cascade.start()

	api = Process(target=launch_api, args=(context,))
	api.start()

	with httpx.Client() as client:
		for root_url in [context['API_URL']]:
			wait_for(client, root_url)

	webbrowser.open(context["WEB_URL"])

	try:
		connection.wait(
			(
				cascade.sentinel,
				api.sentinel,
			)
		)
	except KeyboardInterrupt:
		logger.info("keyboard interrupt, application shutting down")
		pass  # no need to spew stacktrace to log

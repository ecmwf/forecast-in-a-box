"""
The fast-api server providing the worker's rest api
"""

# endpoints:
#   [put] submit(job_id: str, job_name: str/enum, job_params: dict[str, Any]) -> Ok
#   [get] results(job_id: str, page: int) -> DataBlock
#      ↑ used by either web_ui to get results, or by other worker to obtain inputs for itself
#   [post] read_from(hostname: str, job_id: str) -> Ok
#      ↑ issued by controller so that this worker can obtain its inputs via `hostname::results(job_id)` call

import logging
import httpx
from typing import Optional
from typing_extensions import Self
from fastapi import FastAPI, HTTPException
import os
from forecastbox.api.controller import JobDefinition, WorkerId, WorkerRegistration
import forecastbox.worker.job_manager as job_manager

logger = logging.getLogger("uvicorn." + __name__)  # TODO instead configure uvicorn the same as the app
app = FastAPI()


class AppContext:
	# TODO use some fastapi tooling for this
	_instance: Optional[Self] = None

	@classmethod
	def get(cls) -> Self:
		if not cls._instance:
			cls._instance = cls()
		return cls._instance

	def __init__(self) -> None:
		self.controller_url = os.environ["FIAB_CTR_URL"]
		self.self_url = os.environ["FIAB_WRK_URL"]
		with httpx.Client() as client:  # TODO pool the client
			registration = WorkerRegistration.from_raw(self.self_url)
			response = client.put(f"{self.controller_url}/workers/register", json=registration.model_dump())
			self.worker_id = WorkerId(**response.json())

	def callback_context(self) -> job_manager.CallbackContext:
		return job_manager.CallbackContext(worker_id=self.worker_id.worker_id, controller_url=self.controller_url, self_url=self.self_url)


@app.api_route("/status", methods=["GET", "HEAD"])
async def status_check() -> str:
	return "ok"


@app.api_route("/init", methods=["POST"])
async def init() -> str:
	# TODO replace with some fastapi hook
	AppContext().get()
	return "ok"


@app.api_route("/jobs/submit/{job_id}", methods=["PUT"])
async def job_submit(job_id: str, definition: JobDefinition) -> str:
	if job_manager.job_submit(AppContext.get().callback_context(), job_id, definition):
		return "ok"
	else:
		raise HTTPException(status_code=500, detail="Internal Server Error")

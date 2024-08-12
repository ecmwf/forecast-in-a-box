"""
The fast-api server providing the worker's rest api
"""

# endpoints:
#   [put] submit(job_id: str, job_name: str/enum, job_params: dict[str, Any]) -> Ok
#   [get] results(job_id: str, page: int) -> DataBlock
#      ↑ used by either web_ui to get results, or by other worker to obtain inputs for itself
#   [post] read_from(hostname: str, job_id: str) -> Ok
#      ↑ issued by controller so that this worker can obtain its inputs via `hostname::results(job_id)` call

from contextlib import asynccontextmanager
import logging
import httpx
from typing import Optional
from typing_extensions import Self
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
import os
from forecastbox.api.common import TaskDAG, WorkerId, WorkerRegistration
import forecastbox.worker.job_manager as job_manager
from multiprocessing import Manager

logger = logging.getLogger("uvicorn." + __name__)  # TODO instead configure uvicorn the same as the app


class AppContext:
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
		self.mem_manager = Manager()
		self.db_context = job_manager.DbContext(
			mem_db=job_manager.MemDb(self.mem_manager),
			job_db=job_manager.JobDb(),
		)

	@property
	def callback_context(self) -> job_manager.CallbackContext:
		return job_manager.CallbackContext(worker_id=self.worker_id.worker_id, controller_url=self.controller_url, self_url=self.self_url)


@asynccontextmanager
async def lifespan(app: FastAPI):
	instance = AppContext.get()
	yield
	job_manager.wait_all(instance.db_context)


app = FastAPI(lifespan=lifespan)


@app.api_route("/status", methods=["GET", "HEAD"])
async def status_check() -> str:
	return "ok"


@app.api_route("/jobs/submit/{job_id}", methods=["PUT"])
async def job_submit(job_id: str, definition: TaskDAG) -> str:
	ctx = AppContext.get()
	if job_manager.job_submit(ctx.callback_context, ctx.db_context, job_id, definition):
		return "ok"
	else:
		raise HTTPException(status_code=500, detail="Internal Server Error")


@app.api_route("/data/{data_id}", methods=["GET"])
async def data_get(data_id: str) -> StreamingResponse:
	try:
		# NOTE we should probably set some mime type here -- but it seems that just dumping bytes works,
		# at least for textual and png bytestreams
		return StreamingResponse(job_manager.data_stream(AppContext.get().db_context.mem_db, data_id))
	except (KeyError, FileNotFoundError):  # TODO this doesnt catch it as the streaming response is lazy
		logger.exception("data retrieval failure")
		raise HTTPException(status_code=404, detail=f"{data_id=} not found")

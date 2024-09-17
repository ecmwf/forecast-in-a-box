"""
Communication layer to the worker
"""

import httpx
import logging

logger = logging.getLogger(__name__)


class WorkerComm:
	def __init__(self) -> None:
		self.client = httpx.AsyncClient()

	async def close(self) -> None:
		await self.client.aclose()

	async def _call(self, request: httpx.Request) -> bool:
		try:
			response = await self.client.send(request)
		except Exception:
			# TODO sleep-retry-or-fail
			logger.exception(f"failed to call {request}")
			return False
		if response.status_code != httpx.codes.OK:
			# TODO sleep-retry-or-fail
			logger.error(f"failed to submit to worker: {response}")
			return False
		return True

	async def call_submit(self, worker_url: str, job_id: str, data: dict) -> bool:
		request = httpx.Request("PUT", f"{worker_url}/jobs/submit/{job_id}", json=data)
		return await self._call(request)

	async def call_heartbeat(self, worker_url: str) -> bool:
		request = httpx.Request("GET", f"{worker_url}/status")
		return await self._call(request)

"""
Communication to controller / other workers
"""

import logging
import httpx
from dataclasses import dataclass
from typing import Optional, Protocol, runtime_checkable
import forecastbox.api.common as api

logger = logging.getLogger(__name__)


@runtime_checkable
class CallbackContext(Protocol):
	"""Contract between worker-server and worker-entrypoint, for notifying
	controller about individual job progress / job results"""

	def data_url(self, job_id: str) -> str:
		"""Formats the url for retrieving job's result"""
		raise NotImplementedError

	def post(self, data: dict) -> bool:
		"""Calls the controller endpoint for job status update"""
		raise NotImplementedError

	def close(self) -> None:
		"""Cleanup methods"""
		raise NotImplementedError


@dataclass
class HttpxCallbackContext:
	"""Httpx-based callback/client for CallbackContext"""

	self_url: str
	controller_url: str
	worker_id: str
	# We set `client` to None because we dont want to pipe this between processes.
	# Within a worker process `client` works as a cached property
	_client: None | httpx.Client = None

	def data_url(self, job_id: str) -> str:
		return f"{self.self_url}/data/{job_id}"

	@property
	def update_url(self) -> str:
		return f"{self.controller_url}/jobs/update/{self.worker_id}"

	def post(self, data: dict) -> bool:
		if self._client is None:
			self._client = httpx.Client()
		response = self._client.post(self.update_url, json=data)
		if response.status_code != httpx.codes.OK:
			logger.error(f"failed to notify update: {response}")
			return False
			# TODO background submit some retry
		else:
			return True

	def close(self) -> None:
		if self._client is not None:
			self._client.close()


class SilentCallbackContext:
	"""For offline/testing usage"""

	def data_url(self, job_id: str) -> str:
		return "nowhere"

	def post(self, data: dict) -> bool:
		return True

	def close(self) -> None:
		pass


def notify_update(
	callback_context: CallbackContext,
	job_id: str,
	status: api.JobStatusEnum,
	result: Optional[str] = None,
	task_name: Optional[str] = None,
	status_detail: Optional[str] = None,
) -> bool:
	logger.info(f"process for {job_id=} is in {status=}")
	result_url: Optional[str]
	if result:
		result_url = callback_context.data_url(result)
	else:
		result_url = None
	update = api.JobStatusUpdate(
		job_id=api.JobId(job_id=job_id),
		status=status,
		task_name=task_name,
		result=result_url,
		status_detail=status_detail,
	)

	return callback_context.post(update.model_dump())

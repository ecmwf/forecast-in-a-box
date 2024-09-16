"""
Communication to controller / other workers
"""

import logging
import httpx
from dataclasses import dataclass
from typing import Optional
import forecastbox.api.common as api

logger = logging.getLogger(__name__)


@dataclass
class CallbackContext:
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
		if not self.controller_url:
			# TODO rather somehow mock, this is just for tests
			logger.warning("no update url provided, assuming offline/test")
			return True

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

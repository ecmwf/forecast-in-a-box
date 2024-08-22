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

	def data_url(self, job_id: str) -> str:
		return f"{self.self_url}/data/{job_id}"

	@property
	def update_url(self) -> str:
		return f"{self.controller_url}/jobs/update/{self.worker_id}"


def notify_update(
	callback_context: CallbackContext, job_id: str, status: api.JobStatusEnum, result: Optional[str] = None, task_name: Optional[str] = None
) -> bool:
	logger.info(f"process for {job_id=} is in {status=}")
	result_url: Optional[str]
	if result:
		result_url = callback_context.data_url(result)
	else:
		result_url = None
	update = api.JobStatusUpdate(job_id=api.JobId(job_id=job_id), status=status, task_name=task_name, result=result_url)

	with httpx.Client() as client:
		response = client.post(callback_context.update_url, json=update.model_dump())
		if response.status_code != httpx.codes.OK:
			logger.error(f"failed to notify update: {response}")
			return False
			# TODO background submit some retry
	return True

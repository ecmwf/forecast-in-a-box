"""
Keeps track of locally-spawned processes which run individual jobs
"""

from multiprocessing.shared_memory import SharedMemory
from dataclasses import dataclass
import logging
import atexit
from forecastbox.api.controller import JobDefinition, JobStatusEnum, JobStatusUpdate, JobId
from forecastbox.jobs.lookup import get_process_target
from multiprocessing import Process, connection
import httpx

logger = logging.getLogger(__name__)
the_jobs: dict[str, Process] = {}
the_memory: dict[str, int] = {}


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


def notify_update(callback_context: CallbackContext, job_id: str, status: JobStatusEnum, result: bool) -> bool:
	logger.info(f"process for {job_id=} is in {status=}")
	# TODO put to different module
	update = JobStatusUpdate(job_id=JobId(job_id=job_id), update={"status": status})
	if result:
		update.update["result"] = callback_context.data_url(job_id)

	with httpx.Client() as client:
		response = client.post(callback_context.update_url, json=update.model_dump())
		if response.status_code != httpx.codes.OK:
			logger.error(f"failed to notify update: {response}")
			return False
			# TODO background submit some retry
	return True


def job_entrypoint(callback_context: CallbackContext, job_id: str, definition: JobDefinition) -> None:
	logging.basicConfig(level=logging.INFO)
	notify_update(callback_context, job_id, JobStatusEnum.running, True)
	# TODO handle input
	target = get_process_target(definition.function_name)
	try:
		result = target(**{**definition.function_parameters, "input": None})
		if result:
			L = len(result)
			mem = SharedMemory(name=job_id, create=True, size=L)
			mem.buf[:L] = result
			mem.close()
			the_memory[job_id] = L
		notify_update(callback_context, job_id, JobStatusEnum.finished, True)
	except Exception:
		logger.exception(f"job with {job_id=} failed")
		notify_update(callback_context, job_id, JobStatusEnum.failed, False)


def job_submit(callback_context: CallbackContext, job_id: str, definition: JobDefinition) -> bool:
	params = {
		"callback_context": callback_context,
		"job_id": job_id,
		"definition": definition,
	}
	the_jobs[job_id] = Process(target=job_entrypoint, kwargs=params)
	the_jobs[job_id].start()
	return True


def wait_all() -> None:
	connection.wait(p.sentinel for p in the_jobs.values())
	for k in the_memory:
		m = SharedMemory(name=k, create=False)
		m.close()
		m.unlink()


def setup():
	# TODO register into some fastapi hook instead -- this does not seem to be called at the end
	atexit.register(wait_all)

"""
Keeps track of locally-spawned processes which run individual jobs
"""

import hashlib
from typing import Iterator, cast, Optional
from multiprocessing.shared_memory import SharedMemory
from dataclasses import dataclass
import logging
from forecastbox.api.common import JobStatusEnum, JobStatusUpdate, JobId, TaskDAG
from forecastbox.jobs.lookup import get_process_target
from multiprocessing import Process, connection
from multiprocessing.managers import SyncManager
import httpx

logger = logging.getLogger(__name__)


class MemDb:
	def __init__(self, m: SyncManager) -> None:
		self.memory: dict[str, int] = cast(dict[str, int], m.dict())


class JobDb:
	def __init__(self) -> None:
		self.jobs: dict[str, Process] = {}


@dataclass
class DbContext:
	mem_db: MemDb
	job_db: JobDb


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


def notify_update(callback_context: CallbackContext, job_id: str, status: JobStatusEnum, result: Optional[str] = None) -> bool:
	logger.info(f"process for {job_id=} is in {status=}")
	# TODO put to different module
	update = JobStatusUpdate(job_id=JobId(job_id=job_id), update={"status": status})
	if result:
		update.update["result"] = callback_context.data_url(result)

	with httpx.Client() as client:
		response = client.post(callback_context.update_url, json=update.model_dump())
		if response.status_code != httpx.codes.OK:
			logger.error(f"failed to notify update: {response}")
			return False
			# TODO background submit some retry
	return True


def shmid(job_id: str, dataset_id: str) -> str:
	# we cant use too long file names for shm, https://trac.macports.org/ticket/64806
	h = hashlib.new("md5", usedforsecurity=False)
	h.update((job_id + dataset_id).encode())
	return h.hexdigest()[:24]


def job_entrypoint(callback_context: CallbackContext, mem_db: MemDb, job_id: str, definition: TaskDAG) -> None:
	# TODO we launch process per job / task dag -- it would be safer to have process per task. Requires
	# refactor of the notify_update API
	logging.basicConfig(level=logging.DEBUG)  # TODO replace with config
	notify_update(callback_context, job_id, JobStatusEnum.running)

	try:
		for task in definition.tasks:
			target = get_process_target(task.function_name)
			params: dict[str, str | memoryview] = {}
			params.update(task.static_params)
			mems = {}
			for param_name, dataset_id in task.dataset_inputs.items():
				key = shmid(job_id, dataset_id.dataset_id)
				if dataset_id.dataset_id not in mems:
					mems[key] = SharedMemory(name=key, create=False)
				params[param_name] = mems[key].buf[: mem_db.memory[key]]  # .tobytes()

			logger.debug(f"running task {task.function_name} in {job_id=} with kwarg keys {','.join(params.keys())}")
			result = target(**params)
			logger.debug(f"finished task {task.function_name} in {job_id=}")

			if task.output_name:
				L = len(result)
				key = shmid(job_id, task.output_name.dataset_id)
				logger.debug(f"result of len {L} from {job_id=} storetd as {key}")
				mem = SharedMemory(name=key, create=True, size=L)
				mem.buf[:L] = result
				mem.close()
				mem_db.memory[key] = L

			for key, mem in mems.items():
				try:
					mem.close()
				except BufferError:
					logger.exception(f"gotten buffer error when closing shm {key}")

		logger.debug(f"finished {job_id=}")
		if definition.output_id:
			output_name = shmid(job_id, definition.output_id.dataset_id)
		else:
			output_name = None
		notify_update(callback_context, job_id, JobStatusEnum.finished, output_name)
	except Exception:
		# TODO free all datasets
		logger.exception(f"job with {job_id=} failed")
		notify_update(callback_context, job_id, JobStatusEnum.failed)


def job_submit(callback_context: CallbackContext, db_context: DbContext, job_id: str, definition: TaskDAG) -> bool:
	params = {
		"callback_context": callback_context,
		"mem_db": db_context.mem_db,
		"job_id": job_id,
		"definition": definition,
	}
	db_context.job_db.jobs[job_id] = Process(target=job_entrypoint, kwargs=params)
	db_context.job_db.jobs[job_id].start()
	return True


def data_stream(mem_db: MemDb, data_id: str) -> Iterator[bytes]:
	# TODO logging doesnt work here? Probably we run in some fastapi thread
	if (L := mem_db.memory.get(data_id, -1)) < 0:
		raise KeyError(f"{data_id=} not present")
	m = SharedMemory(name=data_id, create=False)
	i = 0
	block_len = 1024
	while i < L:
		yield bytes(m.buf[i : min(L, i + block_len)])
		i += block_len


def wait_all(db_context: DbContext) -> None:
	connection.wait(p.sentinel for p in db_context.job_db.jobs.values())
	for k in db_context.mem_db.memory:
		m = SharedMemory(name=k, create=False)
		m.close()
		m.unlink()

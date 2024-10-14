"""
Receives commands from the server, launches new controller-executor instances, keeps track of them.
Currently supports only one active instance at a time
"""

# NOTE purposefully poor on external interface
# to have something better, we'd need better monitoring capabilities on the executor/controller interfaces first
# afterwards, we'll extend message passing from the Process here to this class, and accordingly server endpoints

from cascade.low.core import JobInstance
from forecastbox.utils import logging_config
from cascade.controller.impl import CascadeController
from forecastbox.executor.executor import SingleHostExecutor
import cascade.shm.api as shm_api
from forecastbox.executor.futures import DataFuture
from cascade.low.scheduler import schedule as scheduler
from multiprocessing import Process
from cascade.low.views import dependants
import cascade.shm.server as shm_server
import cascade.shm.client as shm_client
from typing import Iterator
import logging

logger = logging.getLogger(__name__)


def job_entrypoint(job: JobInstance) -> None:
	logger.debug(job)
	shm_client.ensure()
	controller = CascadeController()
	executor = SingleHostExecutor()
	schedule = scheduler(job, executor.get_environment()).get_or_raise()
	controller.submit(job, schedule, executor)
	executor.procwatch.join()


class ControllerManager:
	def __init__(self) -> None:
		self.p: Process | None = None
		gb4 = 4 * (1024**3)
		port = 12345
		shm_api.publish_client_port(port)
		self.shm = Process(target=shm_server.entrypoint, args=(port, gb4, logging_config))
		self.shm.start()
		self.outputs: list[DataFuture] = []

	def newJob(self, job: JobInstance) -> None:
		if self.p:
			if self.p.exitcode is None:
				raise ValueError("there is a job in progress")
			else:
				self.p.join()

		self.p = Process(target=job_entrypoint, kwargs={"job": job})
		self.p.start()

		outputDependants = dependants(job.edges)
		self.outputs = [
			DataFuture(taskName=taskName, outputName=outputName)
			for taskName, taskInstance in job.tasks.items()
			for outputName in taskInstance.definition.output_schema.keys()
			if not outputDependants[(taskName, outputName)]
		]

	def status(self) -> str:
		if not self.p:
			return "No job submitted"
		if self.p.exitcode is None:
			return "Still running"
		elif self.p.exitcode == 0:
			return "Finished"
		else:
			return "Failed"

	def close(self) -> None:
		shm_client.shutdown()
		self.shm.join()

	def stream(self, key: str) -> Iterator[bytes]:
		buf = shm_client.get(key)
		i = 0
		block_len = 1024
		while i < buf.l:
			yield bytes(buf.view()[i : min(buf.l, i + block_len)])
			i += block_len
		buf.close()

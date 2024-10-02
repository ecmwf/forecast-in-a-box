"""
Receives commands from the server, launches new controller-executor instances, keeps track of them.
Currently supports only one active instance at a time
"""

# NOTE purposefully poor on external interface
# to have something better, we'd need better monitoring capabilities on the executor/controller interfaces first
# afterwards, we'll extend message passing from the Process here to this class, and accordingly server endpoints

from cascade.low.core import JobInstance
from cascade.controller.impl import CascadeController
from cascade.controller.api import PurgingPolicy
from forecastbox.executor.executor import SingleHostExecutor
from forecastbox.executor.futures import DataFuture
from cascade.low.scheduler import schedule as scheduler
from multiprocessing.managers import DictProxy
from forecastbox.executor.shmdb import ShmDb
from multiprocessing import Process
from multiprocessing import Manager
from cascade.low.views import dependants
from typing import Iterator
import logging

logger = logging.getLogger(__name__)


def job_entrypoint(job: JobInstance, shmd: DictProxy) -> None:
	logger.debug(job)
	controller = CascadeController()
	executor = SingleHostExecutor(shmd)
	policy = PurgingPolicy()
	schedule = scheduler(job, executor.get_environment()).get_or_raise()
	controller.submit(job, schedule, executor, policy)
	executor.procwatch.join()


class ControllerManager:
	def __init__(self) -> None:
		self.p: Process | None = None
		self.mem_manager = Manager()
		self.shmd = self.mem_manager.dict()
		self.outputs: list[DataFuture] = []

	def newJob(self, job: JobInstance) -> None:
		if self.p:
			if self.p.exitcode is None:
				raise ValueError("there is a job in progress")
			else:
				# NOTE perhaps more fine grained teardown
				self.p.join()
				ShmDb(self.shmd).purge_all()

		self.p = Process(target=job_entrypoint, kwargs={"job": job, "shmd": self.shmd})
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

	def stream(self, shmid: str) -> Iterator[bytes]:
		return ShmDb(self.shmd).stream(shmid)

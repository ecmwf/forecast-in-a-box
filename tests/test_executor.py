from cascade.low.builders import JobBuilder, TaskBuilder
import forecastbox.worker.serde as serde
from cascade.low.core import JobInstance
from forecastbox.executor.ctrlmngr import ControllerManager
from forecastbox.executor.shmdb import ShmDb


def test_e2e():
	def test_func(x: int, y: int, z: int) -> int:
		return x + y + z

	ctrlmngr = ControllerManager()

	# 1-node graph
	try:
		task = TaskBuilder.from_callable(test_func).with_values(x=1, y=2, z=3)
		job = JobInstance(tasks={"task": task}, edges=[])
		expected = 1 + 2 + 3

		ctrlmngr.newJob(job)
		ctrlmngr.p.join()

		assert ctrlmngr.p.exitcode == 0
		result_raw = list(ctrlmngr.stream(ctrlmngr.outputs[0].asShmId()))[0]
		result = serde.from_bytes(result_raw, "int")
		assert expected == result

		# 2-node graph
		task1 = TaskBuilder.from_callable(test_func).with_values(x=1, y=2, z=3)
		task2 = TaskBuilder.from_callable(test_func).with_values(y=4, z=5)
		job = JobBuilder().with_node("task1", task1).with_node("task2", task2).with_edge("task1", "task2", 0).build().get_or_raise()
		expected = 5 + 4 + 3 + 2 + 1

		ctrlmngr.newJob(job)
		ctrlmngr.p.join()

		assert ctrlmngr.p.exitcode == 0
		result_raw = list(ctrlmngr.stream(ctrlmngr.outputs[0].asShmId()))[0]
		result = serde.from_bytes(result_raw, "int")
		assert expected == result
	finally:
		shmdb = ShmDb(ctrlmngr.shmd)
		shmdb.purge_all()

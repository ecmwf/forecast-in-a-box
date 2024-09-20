from cascade.v2.builders import JobBuilder, TaskBuilder
from cascade.v2.core import Environment, Host
import cascade.v2.scheduler as scheduler
from forecastbox.api.adapter import cascade2fiab
from forecastbox.worker.reporting import SilentCallbackContext
from forecastbox.worker.entrypoint import job_entrypoint
from forecastbox.worker.db import MemDb
from multiprocessing import Manager


def test_cascade_adapter() -> None:
	N = 5

	# helper callables for int<->bytes
	b2i = lambda b: (int.from_bytes(b, "big"))
	i2b = lambda i: i.to_bytes(2, "big")

	# define operations / graph node types
	reader = TaskBuilder.from_callable(i2b).with_values(i=0)
	processor = TaskBuilder.from_callable(lambda b: i2b(b2i(b) + 1))
	writer = TaskBuilder.from_callable(lambda b: f"value is {b2i(b)}".encode("ascii"))

	# build graph
	builder = JobBuilder().with_node("reader", reader)
	prev = "reader"
	for i in range(N):
		thys = f"process-{i}"
		builder = builder.with_node(thys, processor).with_edge(prev, thys, "b")
		prev = thys
	job_instance = builder.with_node("writer", writer).with_edge(prev, "writer", "b").build().get_or_raise()

	# create "cluster" and schedule
	environment = Environment(hosts={"h1": Host(memory_mb=1024)})
	maybe_schedule = scheduler.schedule(job_instance, environment)
	assert maybe_schedule.e is None

	# from cascade to fiab
	maybe_dag = cascade2fiab(job_instance, maybe_schedule.get_or_raise())
	assert maybe_dag.e is None

	# mocks
	test_callback_context = SilentCallbackContext()
	test_manager = Manager()
	test_mem_db = MemDb(test_manager)

	# execute
	result = job_entrypoint(test_callback_context, test_mem_db, "job_id", maybe_dag.get_or_raise())

	# cleanup
	test_mem_db.close_all()

	assert result

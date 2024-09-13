from cascade.graph.samplegraphs import linear
from cascade.v2.fluent import graph2job
from cascade.v2.core import Environment, Host
import cascade.v2.scheduler as scheduler
from forecastbox.api.adapter import cascade2fiab
from forecastbox.worker.reporting import CallbackContext
from forecastbox.worker.entrypoint import job_entrypoint
from forecastbox.worker.db import MemDb
from multiprocessing.shared_memory import SharedMemory
from multiprocessing import Manager


def test_cascade_adapter():
	N = 5
	g = linear(N)
	for node in g.nodes():
		if node.is_source():
			node.payload = (lambda input: bytes(input), [], {"input": b"a"})
		elif node.is_processor():
			node.payload = (lambda input: bytes(input) + b"a", ["input"], {})
		elif node.is_sink():
			node.payload = (lambda input: bytes(input), ["input"], {})
	job_instance = graph2job(g)

	environment = Environment(hosts={"h1": Host(memory_mb=1024)})
	maybe_schedule = scheduler.schedule(job_instance, environment)
	assert maybe_schedule.e is None

	maybe_dag = cascade2fiab(job_instance, maybe_schedule.get_or_raise())
	assert maybe_dag.e is None

	# rather a stub for the notify_update instead
	test_callback_context = CallbackContext(
		self_url="",
		controller_url="",
		worker_id="",
	)
	test_manager = Manager()
	test_mem_db = MemDb(test_manager)

	import logging

	logging.basicConfig(level="DEBUG", force=True)
	result = job_entrypoint(test_callback_context, test_mem_db, "job_id", maybe_dag.get_or_raise())

	for k in test_mem_db.memory:
		m = SharedMemory(name=k, create=False)
		m.close()
		m.unlink()

	assert result

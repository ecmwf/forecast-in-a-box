from cascade.graph import Graph, Node
from cascade.v2.fluent import graph2job
from cascade.v2.core import Environment, Host
import cascade.v2.scheduler as scheduler
from forecastbox.api.adapter import cascade2fiab
from forecastbox.worker.reporting import SilentCallbackContext
from forecastbox.worker.entrypoint import job_entrypoint
from forecastbox.worker.db import MemDb
from multiprocessing import Manager


def test_cascade_adapter() -> None:
	N = 5
	r = Node("reader", payload=(lambda input: bytes(input), [], {"input": b"a"}))
	p: Node = r
	for i in range(N):
		p = Node(f"process-{i}", input=p, payload=(lambda input: bytes(input) + b"a", ["input"], {}))
	w = Node("writer", input=p, payload=(lambda input: bytes(input), ["input"], {}))
	g = Graph([w])  # NOTE w is not a sink from cascade's pow
	job_instance = graph2job(g)
	print(job_instance)

	environment = Environment(hosts={"h1": Host(memory_mb=1024)})
	maybe_schedule = scheduler.schedule(job_instance, environment)
	assert maybe_schedule.e is None

	maybe_dag = cascade2fiab(job_instance, maybe_schedule.get_or_raise())
	assert maybe_dag.e is None

	test_callback_context = SilentCallbackContext()
	test_manager = Manager()
	test_mem_db = MemDb(test_manager)

	result = job_entrypoint(test_callback_context, test_mem_db, "job_id", maybe_dag.get_or_raise())

	test_mem_db.close_all()

	assert result

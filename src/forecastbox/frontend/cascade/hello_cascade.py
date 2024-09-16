from forecastbox.frontend.cascade.contract import CascadeJob, FormBuilder
from cascade.graph import Graph, Node
from cascade.v2.fluent import graph2job
from cascade.v2.core import JobInstance
from forecastbox.api.common import JinjaTemplate


def job_builder(params: dict[str, str]) -> JobInstance:
	N = int(params["jobs.total"])

	r = Node("reader", payload=(lambda input: int(input).to_bytes(2, "big"), [], {"input": params["reader.input"]}))
	p: Node = r
	for i in range(N):
		p = Node(f"process-{i}", input=p, payload=(lambda input: (int.from_bytes(input, "big") + 1).to_bytes(2, "big"), ["input"], {}))
	w = Node("writer", input=p, payload=(lambda input: f"value is {int.from_bytes(input, 'big')}".encode("ascii"), ["input"], {}))
	g = Graph([w])  # NOTE w is not a sink from cascade's pow
	return graph2job(g)


HelloCascade = CascadeJob(
	form_builder=FormBuilder(
		template=JinjaTemplate.prepare,
		params={
			"job_name": "hello_cascade",
			"job_template": "Hello Cascade",
			"job_type": "cascade",
			"params": [
				(
					"reader.input",
					"int",
					"0",
				),
				(
					"jobs.total",
					"int",
					"5",
				),
			],
		},
	),
	job_builder=job_builder,
)

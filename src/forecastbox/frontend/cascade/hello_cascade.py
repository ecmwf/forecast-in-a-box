from forecastbox.frontend.cascade.contract import CascadeJob, FormBuilder
from cascade.v2.builders import JobBuilder, TaskBuilder
from forecastbox.api.common import JinjaTemplate


def job_builder(params: dict[str, str]) -> JobBuilder:
	N = int(params["jobs.total"])

	b2i = lambda b: (int.from_bytes(b, "big"))
	i2b = lambda i: i.to_bytes(2, "big")

	reader = TaskBuilder.from_callable(i2b).with_values(i=int(params["reader.input"]))
	processor = TaskBuilder.from_callable(lambda b: i2b(b2i(b) + 1))
	writer = TaskBuilder.from_callable(lambda b: f"value is {b2i(b)}".encode("ascii"))

	builder = JobBuilder().with_node("reader", reader)
	prev = "reader"
	for i in range(N):
		thys = f"process-{i}"
		builder = builder.with_node(thys, processor).with_edge(prev, thys, "b")
		prev = thys
	job = builder.with_node("writer", writer).with_edge(prev, "writer", "b")

	return job


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

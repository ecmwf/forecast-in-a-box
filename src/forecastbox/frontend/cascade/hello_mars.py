from forecastbox.frontend.cascade.contract import CascadeJob, FormBuilder
import pathlib
from cascade.graph import Graph, Node
from cascade.v2.fluent import graph2job
from cascade.v2.core import JobInstance, TaskInstance, TaskDefinition, Task2TaskEdge
from forecastbox.api.common import JinjaTemplate
from forecastbox.api.type_system import marsParamList


def job_builder(params: dict[str, str]) -> JobInstance:
	r = Node(
		"reader",
		payload=TaskInstance(
			definition=TaskDefinition(
				entrypoint="forecastbox.external.data_sources.oper_sfc_box_query",
				func=None,
				environment=["numpy<2.0.0", "ecmwf-api-client", "earthkit-data", "earthkit-plots"],
				input_schema_ps={},
				input_schema_kw={
					"days_ago": "int",
					"step": "int",
					"box_center_lat": "latitude",
					"box_center_lon": "longitude",
					"params": "marsParamList",
				},
				output_schema={"__default__": "grib"},
			),
			static_input_ps={},
			static_input_kw={
				"days_ago": int(params.get("days_ago", "1")),
				"step": int(params.get("step", "1")),
				"box_center_lat": int(params.get("box_center_lat", "50")),
				"box_center_lon": int(params.get("box_center_lon", "50")),
				"params": marsParamList(params.get("params", "2t")),
			},
		).model_dump(),
	)
	t = Node(
		"transform",
		input=r,
		payload=TaskInstance(
			definition=TaskDefinition(
				entrypoint="forecastbox.external.grib_mir.transform",
				func=None,
				environment=[str(pathlib.Path.home() / "src/mir-python/dist/mir_python-0.2.0-cp311-cp311-linux_x86_64.whl")],
				input_schema_ps={},
				input_schema_kw={"area": "latlonArea", "input_grib": "grib"},
				output_schema={"__default__": "grib"},
			),
			static_input_ps={},
			static_input_kw={"area": params.get("cropArea", "60/40/40/60")},
		).model_dump(),
	)
	o = Node(
		"plot",
		input=t,
		payload=TaskInstance(
			definition=TaskDefinition(
				entrypoint="forecastbox.external.data_sinks.plot_single_grib",
				func=None,
				environment=["numpy<2.0.0", "earthkit-data", "earthkit-plots"],
				input_schema_ps={},
				input_schema_kw={
					"input_grib": "grib",
					"box_lat1": "latitude",
					"box_lat2": "latitude",
					"box_lon1": "longitude",
					"box_lon2": "longitude",
					"grib_idx": "int",
					"grib_param": "Optional[marsParam]",
				},
				output_schema={"__default__": "png"},
			),
			static_input_ps={},
			static_input_kw={
				"box_lat1": 40,
				"box_lat2": 60,
				"box_lon1": 40,
				"box_lon2": 60,
				"grib_idx": 0,
				"grib_param": "",
			},
		).model_dump(),
	)
	g = Graph([o])
	j = graph2job(g)
	# TODO fix cascade fluent convertor
	j.edges = [
		Task2TaskEdge(
			source_task="reader", source_output="__default__", sink_task="transform", sink_input_kw="input_grib", sink_input_ps=None
		),
		Task2TaskEdge(
			source_task="transform", source_output="__default__", sink_task="plot", sink_input_kw="input_grib", sink_input_ps=None
		),
	]
	return j


HelloMars = CascadeJob(
	form_builder=FormBuilder(
		template=JinjaTemplate.prepare,
		params={
			"job_name": "hello_mars",
			"job_template": "Hello Mars",
			"job_type": "cascade",
			"params": [
				(
					"days_ago",
					"int",
					"1",
				),
				(
					"step",
					"int",
					"1",
				),
				(
					"box_center_lat",
					"latitude",
					"50",
				),
				(
					"box_center_lon",
					"longitude",
					"50",
				),
				(
					"params",
					"marsParamList",
					"2t",
				),
				(
					"cropArea",
					"latlonArea",
					"60/40/40/60",
				),
			],
		},
	),
	job_builder=job_builder,
)

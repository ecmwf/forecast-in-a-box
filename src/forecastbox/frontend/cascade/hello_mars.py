from forecastbox.frontend.cascade.contract import CascadeJob, FormBuilder
import pathlib
from cascade.v2.builders import JobBuilder, TaskBuilder
from forecastbox.api.common import JinjaTemplate
from forecastbox.api.type_system import marsParamList


def job_builder(params: dict[str, str]) -> JobBuilder:
	reader = TaskBuilder.from_entrypoint(
		entrypoint="forecastbox.external.data_sources.oper_sfc_box_query",
		environment=["numpy<2.0.0", "ecmwf-api-client", "earthkit-data", "earthkit-plots"],
		input_schema={
			"days_ago": "int",
			"step": "int",
			"box_center_lat": "latitude",
			"box_center_lon": "longitude",
			"params": "marsParamList",
		},
		output_class="grib.earthkit",
	).with_values(
		days_ago=int(params.get("days_ago", "1")),
		step=int(params.get("step", "1")),
		box_center_lat=int(params.get("box_center_lat", "50")),
		box_center_lon=int(params.get("box_center_lon", "50")),
		params=marsParamList(params.get("params", "2t")),
	)

	transform = TaskBuilder.from_entrypoint(
		entrypoint="forecastbox.external.grib_mir.transform",
		environment=[str(pathlib.Path.home() / "src/mir-python/dist/mir_python-0.2.0-cp311-cp311-linux_x86_64.whl")],
		input_schema={"area": "latlonArea", "input_grib": "grib.mir"},
		output_class="grib.mir",
	).with_values(area=params.get("cropArea", "60/40/40/60"))

	plot = TaskBuilder.from_entrypoint(
		entrypoint="forecastbox.external.data_sinks.plot_single_grib",
		environment=["numpy<2.0.0", "earthkit-data", "earthkit-plots"],
		input_schema={
			"input_grib": "grib.earthkit",
			"box_lat1": "latitude",
			"box_lat2": "latitude",
			"box_lon1": "longitude",
			"box_lon2": "longitude",
			"grib_idx": "int",
			"grib_param": "Optional[marsParam]",
		},
		output_class="png",
	).with_values(
		box_lat1=40,
		box_lat2=60,
		box_lon1=40,
		box_lon2=60,
		grib_idx=0,
		grib_param="",
	)

	builder = (
		JobBuilder()
		.with_node("reader", reader)
		.with_node("transform", transform)
		.with_edge("reader", "transform", "input_grib")
		.with_node("plot", plot)
		.with_edge("transform", "plot", "input_grib")
	)
	return builder


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

"""
Atomic Tasks for sinks -- data plots, saves to files, ...
"""

from typing import Optional
import io
import earthkit.plots
import earthkit.data


def plot_single_grib(
	input_grib: memoryview,
	input_grib_len: int,
	box_lat1: float,
	box_lat2: float,
	box_lon1: float,
	box_lon2: float,
	grib_idx: int,
	grib_param: Optional[tuple[str, int]],
) -> bytes:
	plot_box = [box_lon1, box_lon2, box_lat1, box_lat2]
	# plot_box = [box_center_lon - 20, box_center_lon + 20, box_center_lat - 20, box_center_lat + 20]

	# NOTE the buffer is padded by zeroes due to how shm works, so we need to trim by length
	ibuf = io.BytesIO(input_grib[:input_grib_len])
	grib_reader = earthkit.data.from_source("stream", ibuf, read_all=True)

	figure = earthkit.plots.Figure()
	chart = earthkit.plots.Map(domain=plot_box)
	if grib_param:
		if grib_idx != 0:
			raise ValueError(f"both grib idx and grib param specified: {grib_idx=}, {grib_param=}")
		data = grib_reader.sel(param=grib_param[0], level=grib_param[1])
	else:
		data = grib_reader[grib_idx]
	chart.block(data)
	chart.coastlines()
	chart.gridlines()
	figure.add_map(chart)

	obuf = io.BytesIO()
	figure.save(obuf)
	return obuf.getvalue()


def grib_to_file(input_grib: memoryview, input_grib_len: int, path: str) -> bytes:
	# NOTE the buffer is padded by zeroes due to how shm works, so we need to trim by length
	ibuf = io.BytesIO(input_grib[:input_grib_len])
	grib_reader = earthkit.data.from_source("stream", ibuf, read_all=True)

	output_f = earthkit.data.new_grib_output(path)
	for e in grib_reader:
		output_f.write(e.values, template=e)

	return (f"Succesfully saved to {path}").encode()

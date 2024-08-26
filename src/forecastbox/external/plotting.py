"""
Atomic Tasks for plotting of data
"""

import io
import earthkit.plots
import earthkit.data


def plot_single_grib(input_grib: memoryview, input_grib_len: int, box_center_lat: float, box_center_lon: float, grib_idx: int) -> bytes:
	plot_box = [box_center_lon - 20, box_center_lon + 20, box_center_lat - 20, box_center_lat + 20]

	# NOTE the buffer is padded by zeroes due to how shm works, so we need to trim by length
	ibuf = io.BytesIO(input_grib[:input_grib_len])
	grib_reader = earthkit.data.from_source("stream", ibuf, read_all=True)

	figure = earthkit.plots.Figure()
	chart = earthkit.plots.Map(domain=plot_box)
	chart.block(grib_reader[grib_idx])
	chart.coastlines()
	chart.gridlines()
	figure.add_map(chart)

	obuf = io.BytesIO()
	figure.save(obuf)
	return obuf.getvalue()

"""
Atomic Tasks for sinks -- data plots, saves to files, ...
"""

import logging
from typing import Optional
import io
import earthkit.plots
import earthkit.data

logger = logging.getLogger(__name__)


def plot_single_grib(
	input_grib: earthkit.data.Source,
	box_lat1: float,
	box_lat2: float,
	box_lon1: float,
	box_lon2: float,
	grib_idx: int,
	grib_param: Optional[tuple[str, int]],
) -> bytes:
	plot_box = [box_lon1, box_lon2, box_lat1, box_lat2]
	# plot_box = [box_center_lon - 20, box_center_lon + 20, box_center_lat - 20, box_center_lat + 20]

	figure = earthkit.plots.Figure()
	chart = earthkit.plots.Map(domain=plot_box)
	if grib_param:
		if grib_idx != 0:
			raise ValueError(f"both grib idx and grib param specified: {grib_idx=}, {grib_param=}")
		level_sel = grib_param[1] if grib_param[1] != 0 else None  # quirk of grib_reader
		data = input_grib.sel(param=grib_param[0], level=level_sel)
	else:
		data = input_grib[grib_idx]
	chart.block(data)
	chart.coastlines()
	chart.gridlines()
	figure.add_map(chart)

	obuf = io.BytesIO()
	figure.save(obuf)
	return obuf.getvalue()


def grib_to_file(input_grib: earthkit.data.Source, path: str) -> bytes:
	output_f = earthkit.data.new_grib_output(path)
	for e in input_grib:
		output_f.write(e.values, template=e)

	return (f"Succesfully saved to {path}").encode()

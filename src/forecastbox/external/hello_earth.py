"""
Demonstrates earthkit functionality
"""

import io
import earthkit.plots
import earthkit.data
import logging
import datetime as dt

logger = logging.getLogger(__name__)


def entrypoint_marsquery(days_ago: int, midnight_or_noon: int, box_center_lat: float, box_center_lon: float, param: str) -> bytes:
	date = (dt.datetime.utcnow().date() - dt.timedelta(days=(1 + days_ago))).strftime("%Y-%m-%d")
	time = midnight_or_noon * 12
	# TODO modulos
	mars_box = [box_center_lat + 20, box_center_lon - 20, box_center_lat - 20, box_center_lon + 20]
	plot_box = [box_center_lon - 20, box_center_lon + 20, box_center_lat - 20, box_center_lat + 20]
	grib_reader = earthkit.data.from_source(
		"mars",
		stream="enfo",
		grid="O96",
		area=mars_box,
		type="pf",
		number=1,
		date=date,  # "2024-08-12",
		time=time,  # 0,
		levtype="pl",
		levelist="50",
		param=param,
	)

	buf = io.BytesIO()

	figure = earthkit.plots.Figure()
	chart = earthkit.plots.Map(domain=plot_box)
	chart.block(grib_reader)
	chart.coastlines()
	chart.gridlines()

	figure.add_map(chart)
	figure.save(buf)

	return buf.getvalue()

"""
Demonstrates earthkit functionality
"""

import io
import earthkit.plots
import earthkit.data
import logging
import datetime as dt

logger = logging.getLogger(__name__)


def entrypoint_marsquery(**kwargs) -> bytes:
	i1 = int(kwargs["days_ago"])
	i2 = int(kwargs["midnight_or_noon"])

	# TODO proper start date, step, bounding box
	date = (dt.datetime.utcnow().date() - dt.timedelta(days=(1 + i1))).strftime("%Y-%m-%d")
	time = i2 * 12
	grib_reader = earthkit.data.from_source(
		"mars",
		stream="enfo",
		grid="O96",
		area=[32, 35, -15, 72],
		type="pf",
		number=1,
		date=date,  # "2024-08-12",
		time=time,  # 0,
		levtype="pl",
		levelist="50",
		param="q",
	)

	buf = io.BytesIO()

	figure = earthkit.plots.Figure()
	chart = earthkit.plots.Map(domain=[-15, 35, 32, 72])
	chart.block(grib_reader)
	chart.coastlines()
	chart.gridlines()

	figure.add_map(chart)
	figure.save(buf)

	return buf.getvalue()

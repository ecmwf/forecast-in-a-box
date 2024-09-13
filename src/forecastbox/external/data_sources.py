"""
Atomic Tasks for data sources: eg, mars querise
"""

import datetime as dt
import io
import earthkit.data


def oper_sfc_box_query(box_center_lat: int, box_center_lon: int, params: list[str], step: int, days_ago: int) -> bytes:
	mars_box = [box_center_lat + 20, box_center_lon - 20, box_center_lat - 20, box_center_lon + 20]
	date = (dt.datetime.utcnow().date() - dt.timedelta(days=(1 + days_ago))).strftime("%Y-%m-%d")
	grib_reader = earthkit.data.from_source(
		"mars",
		stream="oper",
		grid="O96",
		area=mars_box,
		type="fc",
		step=step,
		date=date,
		time="00:00:00",
		levtype="sfc",
		levelist="50",
		param=params,
	)

	obuf = io.BytesIO()
	output_m = earthkit.data.new_grib_output(obuf)
	for e in grib_reader:
		output_m.write(e.values, template=e)
	output_m.close()
	return obuf.getvalue()


def enfo_range_temp_query(lat: float, lon: float) -> bytes:
	area = [lat + 5, lon - 5, lat - 5, lon + 5]
	now = dt.datetime.utcnow() - dt.timedelta(days=1)
	dates = [(now - dt.timedelta(days=i)).strftime("%Y-%m-%d") for i in range(10)]
	dates.reverse()
	raw = earthkit.data.from_source(
		"mars", step=0, stream="enfo", grid="O96", area=area, type="pf", number=1, date=dates, time=[0, 12], param="167.128", levtype="sfc"
	)

	means = raw.to_pandas().groupby(["datetime"]).value.mean().reset_index().rename(columns={"datetime": "ds", "value": "y"})
	means.insert(0, "unique_id", 1)

	return means.to_records(index=False).tobytes()

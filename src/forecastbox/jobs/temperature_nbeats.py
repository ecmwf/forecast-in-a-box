"""
A very simplistic ML model for forecasting temperature using NBEATS
"""


def get_data(**kwargs) -> bytes:
	return b""


def predict(**kwargs) -> bytes:
	return b""


# NOTE disabled until install works
# import datetime as dt
# from neuralforecast.core import NeuralForecast
# import pandas as pd
# import numpy as np
# import earthkit.data
#
#
# def get_data(**kwargs) -> bytes:
# 	lat = int(kwargs["start_date"])
# 	lon = int(kwargs["end_date"])
#
# 	area = [lat + 5, lon - 5, lat - 5, lon + 5]
# 	now = dt.datetime.utcnow() - dt.timedelta(days=1)
# 	dates = [(now - dt.timedelta(days=i)).strftime("%Y-%m-%d") for i in range(10)]
# 	dates.reverse()
# 	raw = earthkit.data.from_source(
# 		"mars", step=0, stream="enfo", grid="O96", area=area, type="pf", number=1, date=dates, time=[0, 12], param="167.128", levtype="sfc"
# 	)
#
# 	means = raw.to_pandas().groupby(["datetime"]).value.mean().reset_index().rename(columns={"datetime": "ds", "value": "y"})
# 	means.insert(0, "unique_id", 1)
#
# 	return means.to_records(index=False).tobytes()
#
#
# def predict(**kwargs) -> bytes:
# 	raw = kwargs["data"]
# 	df = pd.DataFrame(np.frombuffer(raw, dtype=[("unique_id", "<i8"), ("ds", "<M8[us]"), ("y", "<f8")], count=10))
#
# 	# TODO read from packaged data instead
# 	model = NeuralForecast.load("/Users/ecm6012/src/forecast-in-a-box/src/forecastbox/jobs/models/nbeats.nf")
#
# 	# TODO fix this
# 	# model.models[0].trainer_kwargs = {'max_steps': 100}
# 	# model.fit(df[:8])
# 	# result = model.predict()
# 	result = model.predict(df[:8])
# 	result_s = ",".join(str(e) for e in result.NBEATS)
# 	true_s = ",".join(str(e) for e in df[8:].y)
# 	return (f"true values are {true_s}, predicted are {result_s}").encode()

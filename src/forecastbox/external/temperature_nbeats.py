"""
A very simplistic ML model for forecasting temperature using NBEATS
"""

import logging
import datetime as dt
import pandas as pd
import numpy as np
import forecastbox.external.models

logger = logging.getLogger(__name__)


def get_data(lat: int, lon: int) -> bytes:
	# NOTE we import here to keep it localized to the worker process only -- there is some fork issues otherwise
	import earthkit.data

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


def predict(input_df: memoryview, input_df_len: int) -> bytes:
	# NOTE we import here to keep it localized to the worker process only -- there is some fork issues otherwise
	from neuralforecast.core import NeuralForecast

	raw = input_df[:input_df_len]
	# NOTE update the dtype when changing data -- the correct is given in the output of `df.to_records(index=False).__repr__()`
	df = pd.DataFrame(np.frombuffer(raw, dtype=[("unique_id", "<i8"), ("ds", "<M8[ns]"), ("y", "<f8")]))

	model_path = str(forecastbox.external.models.get_path("nbeats.nf"))
	model = NeuralForecast.load(model_path)

	# TODO fix this
	# model.models[0].trainer_kwargs = {'max_steps': 100}
	# model.fit(df[:8])
	# result = model.predict()
	result = model.predict(df[:8])
	result_s = ",".join(str(e) for e in result.NBEATS)
	true_s = ",".join(str(e) for e in df[8:10].y)
	return (f"true values are {true_s}, predicted are {result_s}").encode()

"""
A very simplistic ML model for forecasting temperature using NBEATS
"""

import logging
import pandas as pd
import numpy as np
import forecastbox.external.models

logger = logging.getLogger(__name__)


def predict(input_df: memoryview) -> bytes:
	# NOTE we import here to keep it localized to the worker process only -- there is some fork issues otherwise
	from neuralforecast.core import NeuralForecast

	# NOTE update the dtype when changing data -- the correct is given in the output of `df.to_records(index=False).__repr__()`
	df = pd.DataFrame(np.frombuffer(input_df, dtype=[("unique_id", "<i8"), ("ds", "<M8[ns]"), ("y", "<f8")]))

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

"""
Demonstrates aifs inference
"""

from typing import Callable, Optional
import io
import earthkit.plots
import earthkit.data
import logging
import datetime as dt
from functools import cached_property
import climetlab as cml
import tqdm
from anemoi.inference.runner import DefaultRunner
import forecastbox.external.models

logger = logging.getLogger(__name__)


class RequestBasedInput:
	def __init__(self, checkpoint, dates):
		self.checkpoint = checkpoint
		self.dates = dates

	@cached_property
	def fields_sfc(self):
		param = self.checkpoint.param_sfc
		if not param:
			return cml.load_source("empty")

		logger.info(f"Loading surface fields from {self.WHERE}")
		return cml.load_source(
			"multi",
			[
				self.sfc_load_source(
					date=date,
					time=time,
					param=param,
					grid=self.checkpoint.grid,
					area=self.checkpoint.area,
				)
				for date, time in self.dates
			],
		)

	@cached_property
	def fields_pl(self):
		param, level = self.checkpoint.param_level_pl
		if not (param and level):
			return cml.load_source("empty")

		logger.info(f"Loading pressure fields from {self.WHERE}")
		return cml.load_source(
			"multi",
			[
				self.pl_load_source(
					date=date,
					time=time,
					param=param,
					level=level,
					grid=self.checkpoint.grid,
					area=self.checkpoint.area,
				)
				for date, time in self.dates
			],
		)

	@cached_property
	def fields_ml(self):
		param, level = self.checkpoint.param_level_ml
		if not (param and level):
			return cml.load_source("empty")

		logger.info(f"Loading model fields from {self.WHERE}")
		return cml.load_source(
			"multi",
			[
				self.ml_load_source(
					date=date,
					time=time,
					param=param,
					level=level,
					grid=self.checkpoint.grid,
					area=self.checkpoint.area,
				)
				for date, time in self.dates
			],
		)

	@cached_property
	def all_fields(self):
		return self.fields_sfc + self.fields_pl + self.fields_ml


class MarsInput(RequestBasedInput):
	WHERE = "MARS"

	def pl_load_source(self, **kwargs):
		kwargs["levtype"] = "pl"
		logger.debug("load source mars %s", kwargs)
		return cml.load_source("mars", kwargs)

	def sfc_load_source(self, **kwargs):
		kwargs["levtype"] = "sfc"
		logger.debug("load source mars %s", kwargs)
		return cml.load_source("mars", kwargs)

	def ml_load_source(self, **kwargs):
		kwargs["levtype"] = "ml"
		logger.debug("load source mars %s", kwargs)
		return cml.load_source("mars", kwargs)


def entrypoint_forecast(predicted_param: str, target_step: int) -> bytes:
	# config TODO read from kwargs
	model_path = forecastbox.external.models.get_path("aifs-small.ckpt")
	relative_delay = dt.timedelta(days=1)  # TODO how to get a reliable date for which data would be available?
	save_to_path: Optional[str] = None  # "/tmp/output.grib"

	# prep clasess
	n = dt.datetime.now() - relative_delay
	d1 = n - dt.timedelta(hours=n.hour % 6, minutes=n.minute, seconds=n.second, microseconds=n.microsecond)
	d2 = d1 - dt.timedelta(hours=6)
	f: Callable[[dt.datetime], tuple[int, int]] = lambda d: (
		int(d.strftime("%Y%m%d")),
		d.hour,
	)
	runner = DefaultRunner(str(model_path))
	mars_input = MarsInput(runner.checkpoint, dates=[f(d2), f(d1)])
	lead_time = target_step
	grib_keys = {
		"stream": "oper",
		"expver": 0,
		"class": "rd",
	}
	if save_to_path:
		output_f = cml.new_grib_output(save_to_path, **grib_keys)
	obuf = io.BytesIO()
	output_m = cml.new_grib_output(obuf, **grib_keys)

	def output_callback(*args, **kwargs):
		# example1 kwargs: {'template': GribField(tcw,None,20240815,1200,0,0), 'step': 240, 'check_nans': True}
		# example2 kwargs: {'stepType': 'accum', 'template': GribField(2t,None,20240815,1200,0,0), 'startStep': 0, 'endStep': 240, 'param': 'tp', 'check_nans': True}
		# example template metadata: {'param': '2t', 'levelist': None, 'validityDate': 20240815, 'validityTime': 1200, 'valid_datetime': '2024-08-15T12:00:00'}
		# args is a tuple with args[0] being numpy data
		if "step" in kwargs or "endStep" in kwargs:
			data = args[0]
			template = kwargs.pop("template")
			if template._metadata.get("param", "") == predicted_param and kwargs.get("step", -1) == target_step:
				output_m.write(data, template=template, **kwargs)

			if save_to_path:
				output_f.write(data, template=template, **kwargs)

	# run
	# TODO how to propagate output field projection?
	runner.run(
		input_fields=mars_input.all_fields,
		lead_time=lead_time,
		start_datetime=None,  # will be inferred from the input fields
		device="cuda",
		output_callback=output_callback,
		autocast="16",
		progress_callback=tqdm.tqdm,
	)

	return obuf.getvalue()


def entrypoint_plot(input_grib: memoryview, input_grib_len: int) -> bytes:
	# config
	plot_idx = 0
	domain = [-15, 35, 32, 72]  # TODO param

	# data
	# grib_reader = earthkit.data.from_source("file", path="/tmp/output.grib")
	# NOTE the buffer is padded by zeroes due to how shm works, so we need to trim by length
	ibuf = io.BytesIO(input_grib[:input_grib_len])
	grib_reader = earthkit.data.from_source("stream", ibuf, read_all=True)

	figure = earthkit.plots.Figure()
	# TODO configurable bounding box
	chart = earthkit.plots.Map(domain=domain)
	# TODO configurable param
	chart.block(grib_reader[plot_idx])
	chart.coastlines()
	chart.gridlines()
	figure.add_map(chart)

	obuf = io.BytesIO()
	figure.save(obuf)
	return obuf.getvalue()

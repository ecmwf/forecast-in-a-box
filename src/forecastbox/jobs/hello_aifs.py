"""
Demonstrates aifs inference
"""

from typing import Callable
import io
import earthkit.plots
import earthkit.data
import logging
import datetime as dt
from functools import cached_property
import climetlab as cml
import tqdm
from anemoi.inference.runner import DefaultRunner
import forecastbox.jobs.models

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


def entrypoint_forecast(**kwargs) -> bytes:
	ckpt_path = forecastbox.jobs.models.get_path("aifs-small.ckpt")
	runner = DefaultRunner(str(ckpt_path))

	# TODO how to get a reliable date for which data would be available?
	n = dt.datetime.now() - dt.timedelta(days=1)
	d1 = n - dt.timedelta(hours=n.hour % 6, minutes=n.minute, seconds=n.second, microseconds=n.microsecond)
	d2 = d1 - dt.timedelta(hours=6)
	f: Callable[[dt.datetime], tuple[int, int]] = lambda d: (
		int(d.strftime("%Y%m%d")),
		d.hour,
	)
	mars_input = MarsInput(runner.checkpoint, dates=[f(d2), f(d1)])

	# 10 day forecast
	lead_time = 240  # hours

	grib_keys = {
		"stream": "oper",
		"expver": 0,
		"class": "rd",
	}
	output = cml.new_grib_output("/tmp/output.grib", **grib_keys)

	def output_callback(*args, **kwargs):
		if "step" in kwargs or "endStep" in kwargs:
			data = args[0]
			template = kwargs.pop("template")

			# TODO save to memory instead
			output.write(data, template=template, **kwargs)

	runner.run(
		input_fields=mars_input.all_fields,
		lead_time=lead_time,
		start_datetime=None,  # will be inferred from the input fields
		device="cuda",
		output_callback=output_callback,
		autocast="16",
		progress_callback=tqdm.tqdm,
	)

	return b"placeholder"


def entrypoint_plot(**kwargs) -> bytes:
	grib_reader = earthkit.data.from_source(
		"file",
		path="/tmp/output.grib",  # TODO from memory instead
	)

	buf = io.BytesIO()

	figure = earthkit.plots.Figure()
	# TODO configurable bounding box
	chart = earthkit.plots.Map(domain=[-15, 35, 32, 72])
	# TODO configurable param
	chart.block(grib_reader[0])
	chart.coastlines()
	chart.gridlines()

	figure.add_map(chart)
	figure.save(buf)

	return buf.getvalue()

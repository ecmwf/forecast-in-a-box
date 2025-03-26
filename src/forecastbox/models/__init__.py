import os
from collections import defaultdict

from typing import TYPE_CHECKING, Any

from qubed import Qube

if TYPE_CHECKING:
	from anemoi.inference.checkpoint import Checkpoint
	from cascade.fluent import Action

class Model:
	"""Model Specification"""
	def __init__(self, ckpt: "Checkpoint"):
		self.ckpt = ckpt

	def qube(self, assumptions: dict[str, Any] = None) -> Qube:
		return convert_to_model_spec(self.ckpt, assumptions=assumptions)
	
	def graph(self, initial_conditions, lead_time, **kwargs) -> "Action":
		from anemoi.cascade.fluent import from_initial_conditions, from_input

		return from_input(self.ckpt.path, 'mars', lead_time=lead_time, **kwargs)

	@property
	def ignore_in_select(self) -> list[str]:
		return ["frequency"]


def convert_to_model_spec(ckpt: "Checkpoint", assumptions: dict[str, Any] = None) -> Qube:
	"""Convert an anemoi checkpoint to a Qube."""
	variables = [
		*ckpt.diagnostic_variables,
		*ckpt.prognostic_variables,
	]

	assumptions = assumptions or {}

	# Split variables between pressure and surface
	surface_variables = [v for v in variables if "_" not in v]

	# Collect the levels for each pressure variable
	level_variables = defaultdict(list)
	for v in variables:
		if "_" in v:
			variable, level = v.split("_")
			level_variables[variable].append(int(level))

	model_tree = Qube.empty()

	for variable, levels in level_variables.items():
		model_tree = model_tree | Qube.from_datacube(
			{
				"frequency": ckpt.timestep,
				"levtype": "pl",
				"param": variable,
				# "levelist": list(map(str, levels)),
				**assumptions,
			}
		)

	for variable in surface_variables:
		model_tree = model_tree | Qube.from_datacube(
			{
				"frequency": ckpt.timestep,
				"levtype": "sfc",
				"param": variable,
				**assumptions,
			}
		)

	return model_tree

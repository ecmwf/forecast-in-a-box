"""
For declaring types of dynamic and user parameters of the jobs, and converting user inputs into such types
"""

from forecastbox.utils import Either
from typing import Any

# NOTE we probably want an enum of supported types, each member yielding conv function & class


def latitude(value: str) -> float:
	f = float(value)
	if f > 90.0 or f < -90:
		raise TypeError(f"Latitude out of range [-90,90]: {value:3}")
	return f


def longitude(value: str) -> float:
	f = float(value)
	if f > 180.0 or f < -180:
		raise TypeError(f"Latitude out of range [-90,90]: {value:3}")
	return f


def marsParams(value: str) -> list[str]:
	# TODO can we even hardcode this?
	# marsParams = ["2t", "q"]
	# if value not in marsParams:
	# raise TypeError(f"Not a valid mars parameter: {value}")
	return [e.strip() for e in value.split(",")]


def convert(into: str, value: str) -> Either[Any, str]:
	try:
		value = eval(f"{into}('{value}')")
		return Either.ok(value)
	except Exception as e:
		return Either.error(str(e))

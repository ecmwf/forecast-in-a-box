"""
For declaring types of dynamic and user parameters of the jobs, and converting user inputs into such types
"""

from forecastbox.utils import Either
from typing import Any
import datetime as dt
import re

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


aifs_params_level = [
	"q",
	"t",
	"u",
	"v",
	"w",
	"z",
]
aifs_levels = ["50", "100", "150", "200", "250", "300", "400", "500", "600", "700", "850", "925", "1000"]
aifs_params_surface = [
	"10u",
	"10v",
	"2d",
	"2t",
	"msl",
	"skt",
	"sp",
	"tcw",
	"cp",
	"tp",
]


def marsParam(value: str) -> tuple[str, int]:
	# NOTE currently restricted to aifs output params... we may want to split into two types...
	if value in aifs_params_surface:
		return (value, 0)
	s = value.split(".")
	if len(s) != 2 or s[0] not in aifs_params_level or s[1] not in aifs_levels:
		raise TypeError(f"not a valid aifs output param: {value[:32]}")
	return s[0], int(s[1])


def marsParamList(value: str) -> list[tuple[str, int]]:
	if value == "all":
		return [(param, int(level)) for param in aifs_params_level for level in aifs_levels] + [(param, 0) for param in aifs_params_surface]
	else:
		return [marsParam(e.strip()) for e in value.split(",")]


aifsOutputParamList = marsParamList


def datetime(value: str) -> dt.datetime:
	try:
		return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M")
	except ValueError:
		return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%S")


def convert(into: str, value: str) -> Either[Any, str]:
	try:
		# TODO either introduce a grammar (eg parsimonious), or parse with python proper
		opt_re = r"Optional\[(.*)\]"
		if m := re.match(opt_re, into):
			if value == "":
				return Either.ok(None)
			else:
				into_t = m.groups()[0]
		else:
			into_t = into
		value = eval(f"{into_t}('{value}')")
		return Either.ok(value)
	except Exception as e:
		return Either.error(str(e))

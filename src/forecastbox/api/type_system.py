"""
For declaring types of dynamic and user parameters of the jobs, and converting user inputs into such types
"""

from forecastbox.utils import Either
from typing import Any

# TODO custom types, lat lon, datetime, ... Currently we kinda support just str and int. `into` should be an enum?


def convert(into: str, value: str) -> Either[Any, str]:
	try:
		value = eval(f"{into}('{value}')")
		return Either.ok(value)
	except Exception as e:
		return Either.error(str(e))

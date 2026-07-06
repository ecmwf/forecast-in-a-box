from typing import Any

from pymetkit import ParamDB
from qubed import Qube

from fiab_core.fable import ConfigurationOptionId, QubedOutput
from fiab_core.tools.blocks import BlockInstanceConfigurationError

SOURCE = ConfigurationOptionId("source")
BASETIME = ConfigurationOptionId("base_time")
PATH = ConfigurationOptionId("path")
DOMAIN = ConfigurationOptionId("domain")
FORMAT = ConfigurationOptionId("format")
PARAM = ConfigurationOptionId("param")
ENSEMBLE = ConfigurationOptionId("number")
STEP = ConfigurationOptionId("step")
LEVTYPE = ConfigurationOptionId("levtype")
LEVEL = ConfigurationOptionId("levelist")
DIMENSION = ConfigurationOptionId("dimension")
VALUES = ConfigurationOptionId("values")
GROUPBY = ConfigurationOptionId("groupby")
SPLITBY = ConfigurationOptionId("splitby")
FORECAST = ConfigurationOptionId("forecast")
TYPE = ConfigurationOptionId("type")
STATISTIC = ConfigurationOptionId("statistic")
THRESHOLD = ConfigurationOptionId("threshold")
COMPARISON = ConfigurationOptionId("comparison")


def _create_param_key(param_id: str) -> str:
    db = ParamDB()
    shortname = db.param_id_to_shortname(int(param_id))
    return f"{param_id}-{shortname}"


def _split_param_key(param_key: str) -> tuple[str, str]:
    param_id, shortname = param_key.split("-", 1)
    return param_id, shortname


def _extract_dataset(inputs: dict[str, QubedOutput], name: str) -> QubedOutput:
    input_dataset = inputs.get(name)
    if not isinstance(input_dataset, QubedOutput):
        actual_type = type(input_dataset).__name__ if input_dataset is not None else "None"
        raise BlockInstanceConfigurationError(f"Unsupported input type for '{name}': expected QubedOutput, got {actual_type}")
    return input_dataset


def _is_empty_qube(qube: Qube) -> bool:
    return next(iter(qube.datacubes()), None) is None


def _restriction_value_strings(axis_values: set[Any], item_python_type: type[str] | type[int]) -> list[str]:
    if item_python_type is str:
        return sorted(value for value in axis_values if isinstance(value, str))
    if item_python_type is int:
        return [str(value) for value in sorted(value for value in axis_values if type(value) is int)]
    raise TypeError(f"Unsupported select value type {item_python_type!r}")


def _axis_value_strings(axis_values: set[Any]) -> list[str]:
    if all(isinstance(value, str) for value in axis_values):
        return _restriction_value_strings(axis_values, str)
    if all(type(value) is int for value in axis_values):
        return _restriction_value_strings(axis_values, int)
    return sorted(str(value) for value in axis_values)


def _parse_axis_value(value: str) -> str | int:
    try:
        int_value = int(value)
    except ValueError:
        return value
    return int_value if str(int_value) == value else value
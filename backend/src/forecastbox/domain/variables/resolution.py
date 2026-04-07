# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Core parsing and resolution of ${variable} interpolation in BlockInstance configuration values."""

import re

from cascade.low.func import Either
from fiab_core.fable import BlockInstance

_VARIABLE_PATTERN = re.compile(r"\$\{(\w+)\}")


def merge_variables(automatic_values: dict[str, str], context_values: dict[str, str]) -> dict[str, str]:
    """Merge automatic system variables with caller-supplied context variables.

    context_values take precedence over automatic_values for the same key.
    """
    return {**automatic_values, **context_values}


def _extract_variable_names_from_value(value: str) -> set[str]:
    return set(_VARIABLE_PATTERN.findall(value))


def _substitute_variables(value: str, variable_values: dict[str, str]) -> str:
    return _VARIABLE_PATTERN.sub(lambda m: variable_values[m.group(1)], value)


def extract_variables(blockInstance: BlockInstance) -> Either[set[str], list[str]]:  # type: ignore[invalid-argument]
    """Extract all ${variable} references from the blockInstance's configuration_values.

    Always succeeds; returns the set of referenced variable names. The error branch
    is reserved for future validation (e.g. malformed templates).
    """
    variables: set[str] = set()
    for value in blockInstance.configuration_values.values():
        variables.update(_extract_variable_names_from_value(value))
    return Either.ok(variables)


def resolve_configurations(blockInstance: BlockInstance, variable_values: dict[str, str]) -> None:
    """Mutate blockInstance's configuration_values, replacing ${variable} patterns with their values.

    All variables referenced must be present in variable_values. Call extract_variables
    and validate the set against available variables before invoking this function.
    """
    for key, value in blockInstance.configuration_values.items():
        blockInstance.configuration_values[key] = _substitute_variables(value, variable_values)

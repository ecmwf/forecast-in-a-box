# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import dataclasses
from collections.abc import Mapping
from types import MappingProxyType
from typing import Any, TypeVar

_T = TypeVar("_T")


def freeze_recursively(value: object) -> object:
    """Recursively copy common containers into immutable equivalents."""
    if isinstance(value, Mapping):
        return MappingProxyType({key: freeze_recursively(item) for key, item in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(freeze_recursively(item) for item in value)
    if isinstance(value, (set, frozenset)):
        return frozenset(freeze_recursively(item) for item in value)
    return value


def freeze_mapping(values: Mapping[Any, Any]) -> Mapping[Any, Any]:
    """Return an immutable shallow snapshot of a mapping."""
    return MappingProxyType(dict(values))


def frozendc(cls: type[_T]) -> type[_T]:
    """Frozen dataclass decorator that creates immutable, slotted dataclasses.

    This is a convenience wrapper for @dataclass(frozen=True, eq=True, slots=True).
    Use this for data transfer objects and value types that should be immutable and
    memory-efficient. Benefits: thread-safe, hashable (can be dict keys), prevents
    accidental mutation, reduced memory footprint via slots. Only use on classes
    without inheritance and that don't need post-init mutation.

    Note: Type checkers may not fully understand this decorator. Don't use it yet.
    We also tried a pyi stub, but `ty` isn't ready.
    """
    return dataclasses.dataclass(frozen=True, eq=True, slots=True)(cls)  # type: ignore[return-value]


def deep_union(dict1: dict[str, Any], dict2: dict[str, Any]) -> dict[str, Any]:
    """Recursively merges two dictionaries. In case of conflicts, values from dict2 are preferred. Copies the first."""
    merged = dict1.copy()
    for key, value in dict2.items():
        if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key] = deep_union(merged[key], value)
        else:
            merged[key] = value
    return merged

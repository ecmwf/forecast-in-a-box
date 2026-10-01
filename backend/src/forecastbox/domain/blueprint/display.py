# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Resolution of configuration option values into user-facing display strings.

Some configuration option values are cryptic identifiers (artifact ids, parameter ids) that
the frontend wants to render as human-readable strings. This module resolves such values,
given the Fable type the value conforms to.
"""

from fiab_core.artifacts import CompositeArtifactId
from fiab_core.types import ArtifactType, ParameterType
from fiab_core.types.parser import parse

from forecastbox.domain.artifact.manager import ArtifactManager
from forecastbox.utility.pydantic import FiabBaseModel


class ResolvableValue(FiabBaseModel):
    """A single configuration option value, to be resolved into a display string.

    ``typeName`` is a serialized Fable type expression, e.g. ``"artifact"`` or ``"param"``.
    """

    typeName: str
    value: str


def _resolve_artifact_display(value: str) -> str | None:
    """Resolve an artifact id into its catalog display name, or None if not found."""
    try:
        artifact_id = CompositeArtifactId.from_str(value)
    except Exception:
        return None
    artifact = ArtifactManager.catalog.get(artifact_id)
    if artifact is None:
        return None
    return artifact.common.display_name


def _resolve_parameter_display(value: str) -> str | None:
    """Resolve a parameter id into a human-readable description, or None if resolution fails."""
    # TODO eventually utilize the paramDB provider/singleton, for better perf
    import pymetkit.paramdb

    paramdb = pymetkit.paramdb.ParamDB()
    try:
        paramid = int(value)
        shortname = paramdb.param_id_to_shortname(paramid)
        longname = paramdb.param_id_to_longname(paramid)
        units = paramdb.get_units(paramid)
    except Exception:
        return None
    if shortname is None or longname is None or units is None:
        return None
    return f"{longname} [{units}] ({shortname})"


def configOption2display(elements: list[ResolvableValue]) -> list[str | None]:
    """Resolve a list of configuration option values into display strings.

    For each element, the ``typeName`` is parsed as a Fable type expression. Artifact and
    parameter types are resolved into a display string, or None if resolution fails. Any
    other valid type resolves to None. Raises ValueError if a ``typeName`` is not a valid
    Fable type expression.
    """
    results: list[str | None] = []
    for element in elements:
        fable_type = parse(element.typeName)
        if isinstance(fable_type, ArtifactType):
            results.append(_resolve_artifact_display(element.value))
        elif isinstance(fable_type, ParameterType):
            results.append(_resolve_parameter_display(element.value))
        else:
            results.append(None)
    return results

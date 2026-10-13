# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
We need to be careful with metkit -- it brings the whole compiled stack together with it,
and due to the lack of code/package isolation, it would force it at the runtime level in any
plugin using fiab-core. That may be problematic, for example due to eckitlib bringing
libproj, which colud conflict with eg pyproj's libproj and giving us a segfault at runtime.

Therefore, a dependency injection is applied, where backend, with a safe pymetkit dependency,
can register a ParamDB. At runtime, this correctly crashes -- if a plugin genuinely needs
pymetkit at runtime, it should do so directly, while declaring it itself in the corresponding
block's environment needs.
"""

from collections.abc import Callable


class MetkitParamResolver:
    """Provider for converting between Metkit parameter identifiers and shortnames."""

    _param_id_to_shortname: Callable[[int], str] | None = None
    _shortname_to_param_id: Callable[[str, dict[str, object] | None], int] | None = None

    @classmethod
    def register_param_id_to_shortname(cls, fn: Callable[[int], str]) -> None:
        """Register the parameter id to shortname conversion."""
        cls._param_id_to_shortname = fn

    @classmethod
    def param_id_to_shortname(cls, param_id: int) -> str:
        """Return the shortname for a parameter id."""
        if cls._param_id_to_shortname is None:
            raise RuntimeError("MetkitParamResolver.param_id_to_shortname has not been registered")
        return cls._param_id_to_shortname(param_id)

    @classmethod
    def register_shortname_to_param_id(cls, fn: Callable[[str, dict[str, object] | None], int]) -> None:
        """Register the shortname to parameter id conversion."""
        cls._shortname_to_param_id = fn

    @classmethod
    def shortname_to_param_id(cls, shortname: str, context: dict[str, object] | None = None) -> int:
        """Return the parameter id for a shortname and optional context."""
        if cls._shortname_to_param_id is None:
            raise RuntimeError("MetkitParamResolver.shortname_to_param_id has not been registered")
        return cls._shortname_to_param_id(shortname, context)

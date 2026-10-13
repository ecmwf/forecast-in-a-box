# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from threading import local

from pymetkit.paramdb import ParamDB

_paramdb_context = local()


def get_paramdb() -> ParamDB:
    """Return the current thread's Metkit parameter database."""
    paramdb: ParamDB | None = getattr(_paramdb_context, "paramdb", None)
    if paramdb is None:
        paramdb = ParamDB()
        _paramdb_context.paramdb = paramdb
    return paramdb


def param_id_to_shortname(param_id: int) -> str:
    """Return the shortname for a parameter id using the current thread's database."""
    return get_paramdb().param_id_to_shortname(param_id)


def shortname_to_param_id(shortname: str, context: dict[str, object] | None = None) -> int:
    """Return the parameter id for a shortname using the current thread's database."""
    return get_paramdb().shortname_to_param_id(shortname, context=context)

# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Forecast As BLock Expression (Fable) — thin compatibility shim.

All logic has moved to ``forecastbox.domain.job_definition.service``.
This module re-exports the public names that other modules (e.g.
``api.execution``) still import from here.
"""

from forecastbox.domain.job_definition.service import compile_builder as compile  # noqa: F401
from forecastbox.domain.job_definition.service import validate_expand  # noqa: F401

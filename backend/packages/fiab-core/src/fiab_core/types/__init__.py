# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
FableType: Type system for Forecast As BLock Expression (Fable) configuration values.

Provides parsing, validation, and conversion for a small set of type expressions:
- str, int, float, date, datetime (atomic types)
- country (string subtype)
- enumClosed[subtype](...), enumOpen[subtype](...) (enumeration types, e.g. enumClosed[int](1,2))
- list[FableType] (container types)
- bboxWSEN (bounding box: exactly four integers, west-south-east-north, obeying constraints)
- geodomain (bounding box or region/country names; the frontend renders a map/region picker)
- union[FableType, ...] (union types)
"""

from fiab_core.types.definitions import *
from fiab_core.types.exceptions import *
from fiab_core.types.parser import *

__all__ = []
import fiab_core.types.definitions as definitions
import fiab_core.types.exceptions as exceptions
import fiab_core.types.parser as parser

for mod in (parser, definitions, exceptions):
    __all__.extend((attr for attr in dir(mod) if not attr.startswith("_")))

# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Domain exceptions for the lens layer.

Translated to HTTP exceptions in the routes layer.
"""


class NoLensFound(Exception):
    """Raised when retrieving details of a LensId for which no Lens exists."""


class UnproxyableLens(Exception):
    """Raised when trying to proxy a Lens which is unproxyable, eg, has more than one port or is not running."""

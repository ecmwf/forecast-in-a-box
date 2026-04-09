# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Domain exceptions for the glyphs layer.

Raised by domain.glyphs.global_db; translated to HTTP responses at the router boundary.
"""


class GlobalGlyphNotFound(Exception):
    """Raised when a requested GlobalGlyph does not exist."""


class GlobalGlyphAccessDenied(Exception):
    """Raised when the actor lacks permission to mutate a GlobalGlyph they do not own."""

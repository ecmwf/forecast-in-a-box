# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""ORM model for the GlobalGlyph table.

Shares the jobs database with the other schemata modules in this package -- see
``forecastbox.schemata.jobs`` for the engine/session setup and ``Base`` declaration.
"""

from sqlalchemy import Boolean, CheckConstraint, Column, String, UniqueConstraint

from forecastbox.schemata.jobs import Base
from forecastbox.utility.time import UTCDateTime


class GlobalGlyph(Base):
    """A user-defined glyph available for interpolation in all blueprint configurations.

    The combination of (created_by, key) is unique, so each user may define their own
    glyph for the same key name independently. Public glyphs (created by admins only)
    carry an additional ``overriddable`` flag that controls resolution priority:
    public-overriddable glyphs have the lowest priority and can be shadowed by a user's
    own private glyph; public-nonoverridable glyphs have the highest priority and always win.

    Invariant: ``overriddable`` must be NULL when ``public=False``, and non-NULL when
    ``public=True``. This is enforced at both the schema and domain layers.
    """

    __tablename__ = "global_glyph"

    global_glyph_id = Column(String(255), primary_key=True, nullable=False)
    key = Column(String(255), nullable=False)
    value = Column(String(1024), nullable=False)
    public = Column(Boolean, nullable=False, default=False)
    overriddable = Column(Boolean, nullable=True)
    created_by = Column(String(255), nullable=False)
    created_at = Column(UTCDateTime, nullable=False)
    updated_at = Column(UTCDateTime, nullable=False)

    __table_args__ = (
        UniqueConstraint("created_by", "key", name="uq_global_glyph_created_by_key"),
        CheckConstraint(
            "(public = 1 AND overriddable IS NOT NULL) OR (public = 0 AND overriddable IS NULL)",
            name="chk_global_glyph_overriddable",
        ),
    )

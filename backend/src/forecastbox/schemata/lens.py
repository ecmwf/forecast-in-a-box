# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""ORM model for the LensMetadata table.

Shares the jobs database with the other schemata modules in this package -- see
``forecastbox.schemata.jobs`` for the engine/session setup and ``Base`` declaration.
"""

from sqlalchemy import JSON, Boolean, Column, String

from forecastbox.schemata.jobs import Base
from forecastbox.utility.time import UTCDateTime


class LensMetadata(Base):
    """Generic, frontend-managed metadata attached to a lens type (e.g. skinnyWMS).

    Each user owns their own row per (lens_id, lens_metadata_id) pair -- mirrors
    GlobalGlyph's (created_by, key) pattern. ``public`` rows represent an
    admin-provided default/template and are visible (read-only) to every caller
    in addition to their own rows; they are never merged server-side -- the
    frontend is responsible for combining them as needed.
    """

    __tablename__ = "lens_metadata"

    lens_id = Column(String(255), primary_key=True, nullable=False)
    lens_metadata_id = Column(String(255), primary_key=True, nullable=False)
    created_by = Column(String(255), primary_key=True, nullable=False)
    created_at = Column(UTCDateTime, nullable=False)
    updated_at = Column(UTCDateTime, nullable=False)

    metadata_content = Column(JSON, nullable=True)
    public = Column(Boolean, nullable=False, default=False)

# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""ORM model for the Blueprint table.

Shares the jobs database with the other schemata modules in this package -- see
``forecastbox.schemata.jobs`` for the engine/session setup and ``Base`` declaration.
"""

from typing import Literal

from sqlalchemy import JSON, Boolean, Column, Integer, String

from forecastbox.schemata.jobs import Base
from forecastbox.utility.time import UTCDateTime

BlueprintSource = Literal["plugin_template", "user_defined", "oneoff_execution"]


class Blueprint(Base):
    """Captures everything needed to execute a job.

    Immutable once written; a new version is appended for each save.
    The composite primary key is (blueprint_id, version). `source` distinguishes
    plugin templates, user-defined blueprints, and one-off runs.
    `parent_id` tracks lineage without pinning a version.
    """

    __tablename__ = "blueprint"

    blueprint_id = Column(String(255), primary_key=True, nullable=False)
    version = Column(Integer, primary_key=True, nullable=False)
    created_by = Column(String(255), nullable=False)
    created_at = Column(UTCDateTime, nullable=False)

    # TODO later -- make sure entity validates this
    source = Column(String(64), nullable=False)
    # Optional lineage reference – deliberately no version to keep it discoverable
    parent_id = Column(String(255), nullable=True)

    display_name = Column(String(255), nullable=True)
    display_description = Column(String(1024), nullable=True)
    tags = Column(JSON, nullable=True)

    # stores the full forecastbox.domain.blueprint.service.BlueprintBuilder as JSON
    builder = Column(JSON, nullable=True)

    fiabcore_major = Column(Integer, nullable=False)

    is_deleted = Column(Boolean, nullable=False, default=False)

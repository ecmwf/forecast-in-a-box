# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""ORM model for the PluginState table.

Shares the jobs database with the other schemata modules in this package -- see
``forecastbox.schemata.jobs`` for the engine/session setup and ``Base`` declaration.
"""

from sqlalchemy import JSON, Boolean, Column, String

from forecastbox.schemata.jobs import Base
from forecastbox.utility.time import UTCDateTime


class PluginState(Base):
    """Persisted install state for each configured plugin.

    One row per plugin, keyed by the PluginCompositeId rendered as ``store:local``.
    Written and updated during plugin install; never versioned.
    """

    __tablename__ = "plugin_state"

    plugin_id = Column(String(255), primary_key=True, nullable=False)
    plugin_version = Column(String(255), nullable=False)
    updated_at = Column(UTCDateTime, nullable=False)
    plugin_errors = Column(JSON, nullable=False, default=list)
    excluded_templates = Column(JSON, nullable=False, default=list)
    glyph_remapping = Column(JSON, nullable=False, default=dict)
    template_errors = Column(JSON, nullable=False, default=dict)
    asset_ingest_needed = Column(Boolean, nullable=False, default=True)
    enabled = Column(Boolean, nullable=False, default=True)

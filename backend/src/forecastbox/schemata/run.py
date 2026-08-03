# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""ORM model for the Run table.

Shares the jobs database with the other schemata modules in this package -- see
``forecastbox.schemata.jobs`` for the engine/session setup and ``Base`` declaration.
"""

from typing import Literal

from sqlalchemy import JSON, Boolean, Column, ForeignKeyConstraint, Integer, String

from forecastbox.schemata.jobs import Base
from forecastbox.utility.time import UTCDateTime

RunStatus = Literal["submitted", "preparing", "running", "completed", "failed", "unknown"]


class Run(Base):
    """A single computation that has happened or is happening.

    Mutable (status, outputs, error, cascade identifiers are written at runtime).
    Composite primary key is (run_id, attempt_count); re-runs share the same `run_id`.
    The optional `experiment_id` links this execution to an experiment.
    `compiler_runtime_context` carries per-execution dynamic values (e.g.
    cron tick time, batch element) that were used to resolve the spec.
    """

    __tablename__ = "run"

    run_id = Column(String(255), primary_key=True, nullable=False)
    attempt_count = Column(Integer, primary_key=True, nullable=False)
    created_by = Column(String(255), nullable=False)
    created_at = Column(UTCDateTime, nullable=False)
    updated_at = Column(UTCDateTime, nullable=False)

    blueprint_id = Column(String(255), nullable=False)
    blueprint_version = Column(Integer, nullable=False)

    experiment_id = Column(String(255), nullable=True)
    experiment_version = Column(Integer, nullable=True)
    compiler_runtime_context = Column(JSON, nullable=False)
    experiment_context = Column(String(255), nullable=True)

    # TODO later -- make sure entity validates this
    status = Column(String(50), nullable=False)
    outputs = Column(JSON, nullable=True)
    error = Column(String(255), nullable=True)
    progress = Column(String(255), nullable=True)

    # Filled after successful cascade submission
    cascade_job_id = Column(String(255), nullable=True)
    cascade_proc = Column(Integer, nullable=True)

    is_deleted = Column(Boolean, nullable=False, default=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["blueprint_id", "blueprint_version"],
            ["blueprint.blueprint_id", "blueprint.version"],
        ),
    )

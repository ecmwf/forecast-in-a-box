# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""ORM models for the experiment domain, including its scheduling and triggers subdomains.

Covers ``ExperimentDefinition`` (owned by ``domain.experiment``), ``ExperimentNext``
(owned by ``domain.experiment.scheduling``) and ``ExperimentTriggerEvent`` (owned by
``domain.experiment.triggers``) -- the subdomains do not get their own schemata modules,
their tables are declared here alongside their parent domain's. Shares the jobs database with the other schemata modules in this
package -- see ``forecastbox.schemata.jobs`` for the engine/session setup and ``Base``
declaration.
"""

from typing import Literal

from sqlalchemy import JSON, BigInteger, Boolean, Column, ForeignKeyConstraint, Integer, String, UniqueConstraint

from forecastbox.schemata.jobs import Base
from forecastbox.utility.time import UTCDateTime

ExperimentType = Literal["cron_schedule", "batch_execution", "external_trigger"]


class ExperimentDefinition(Base):
    """Captures that a Blueprint should execute multiple times.

    Immutable; composite primary key is (experiment_definition_id, version).
    `experiment_type` is one of: cron_schedule | batch_execution | external_trigger.
    `experiment_definition` is a JSON blob whose schema depends on the type.
    """

    __tablename__ = "experiment_definition"

    experiment_definition_id = Column(String(255), primary_key=True, nullable=False)
    version = Column(Integer, primary_key=True, nullable=False)
    created_by = Column(String(255), nullable=False)
    created_at = Column(UTCDateTime, nullable=False)

    display_name = Column(String(255), nullable=True)
    display_description = Column(String(1024), nullable=True)
    tags = Column(JSON, nullable=True)

    blueprint_id = Column(String(255), nullable=False)
    blueprint_version = Column(Integer, nullable=False)

    # TODO later -- make sure entity validates this
    experiment_type = Column(String(64), nullable=False)
    experiment_definition = Column(JSON, nullable=True)

    is_deleted = Column(Boolean, nullable=False, default=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["blueprint_id", "blueprint_version"],
            ["blueprint.blueprint_id", "blueprint.version"],
        ),
    )


class ExperimentNext(Base):
    """Mutable table tracking the next scheduled run time for an experiment.

    Kept separate from the immutable ExperimentDefinition so that updating
    the next-run time does not create a new version.
    """

    __tablename__ = "experiment_next"

    experiment_next_id = Column(String(255), primary_key=True, nullable=False)
    experiment_id = Column(String(255), nullable=False, unique=True)
    scheduled_at = Column(UTCDateTime, nullable=False)
    updated_at = Column(UTCDateTime, nullable=False)


class ExperimentTriggerEvent(Base):
    """Mutable record of an external event handled by an external_trigger experiment.

    The unique key (experiment_id, source, event_type, sequence) identifies an event;
    its presence means the event has been handled. `source` is one of: aviso | synthetic.
    `status` is one of: claimed | submitted | failed | skipped_stale.
    """

    __tablename__ = "experiment_trigger_event"

    event_row_id = Column(Integer, primary_key=True, autoincrement=True)
    experiment_id = Column(String(255), nullable=False, index=True)
    source = Column(String(32), nullable=False)
    event_type = Column(String(255), nullable=False)
    sequence = Column(BigInteger, nullable=False)
    status = Column(String(32), nullable=False)
    run_id = Column(String(255), nullable=True)
    message = Column(String(1024), nullable=True)
    published_at = Column(UTCDateTime, nullable=False)
    created_at = Column(UTCDateTime, nullable=False)
    updated_at = Column(UTCDateTime, nullable=False)

    __table_args__ = (UniqueConstraint("experiment_id", "source", "event_type", "sequence", name="uq_experiment_trigger_event_key"),)

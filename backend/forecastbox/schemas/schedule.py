# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Contains db functions for scheduling-related tables

Note that those reside in the jobdb as well -- there is no scheduledb
"""

from sqlalchemy import JSON, Boolean, Column, DateTime, Integer, String
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class ScheduleDefinition(Base):
    __tablename__ = "schedule_definition"

    schedule_id = Column(String(255), primary_key=True, nullable=False)
    cron_expr = Column(String(64), nullable=True)
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)
    exec_spec = Column(JSON, nullable=False)
    dynamic_expr = Column(JSON, nullable=False)
    enabled = Column(Boolean, nullable = False)
    created_by = Column(String(255), nullable=True)
    max_acceptable_delay_hours = Column(Integer, nullable=False)

class ScheduleRun(Base):
    __tablename__ = "schedule_run"

    schedule_run_id = Column(String(255), primary_key=True, nullable=False)
    # TODO have foreign keys here
    schedule_id = Column(String(255), nullable=False)
    job_id = Column(String(255), nullable=False)

    attempt_cnt = Column(Integer, nullable=False)
    scheduled_at = Column(DateTime, nullable=False)
    trigger = Column(String(64), nullable=False) # probably an enum like `cron`, `event` (or event_id?), `request`

class ScheduleNext(Base):
    __tablename__ = "schedule_next"

    schedule_next_id = Column(String(255), primary_key=True, nullable=False)
    schedule_id = Column(String(255), nullable=False, unique=True) # Foreign key to ScheduleDefinition
    scheduled_at = Column(DateTime, nullable=False)

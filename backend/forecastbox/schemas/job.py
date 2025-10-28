# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from sqlalchemy import JSON, Column, DateTime, String
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class JobRecord(Base):
    __tablename__ = "job_records"

    job_id = Column(String(255), primary_key=True, nullable=False)
    status = Column(String(50), nullable=False)  # TODO enum
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)
    graph_specification = Column(JSON, nullable=True)
    created_by = Column(String(255), nullable=True)
    outputs = Column(JSON, nullable=True)
    error = Column(String(255), nullable=True)
    progress = Column(String(255), nullable=True)

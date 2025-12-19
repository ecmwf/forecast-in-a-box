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

from forecastbox.schemas.job import Base


class FableRecord(Base):
    __tablename__ = "fable_records"

    fable_builder_id = Column(String(255), primary_key=True, nullable=False)
    fable_builder_v1 = Column(JSON, nullable=False)
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)
    created_by = Column(String(255), nullable=True)
    tags = Column(JSON, nullable=True)

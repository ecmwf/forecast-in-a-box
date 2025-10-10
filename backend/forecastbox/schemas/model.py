# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from sqlalchemy import Column, DateTime, Integer, String
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()


class ModelDownload(Base):
    __tablename__ = "model_downloads"

    model_id = Column(String(255), primary_key=True, nullable=False)
    progress = Column(Integer, nullable=False)
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)
    error = Column(String(255), nullable=True)


class ModelEdit(Base):
    __tablename__ = "model_edits"

    created_at = Column(DateTime, nullable=False)
    model_id = Column(String(255), primary_key=True, nullable=False)

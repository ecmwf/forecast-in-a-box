from sqlalchemy import Column, String, DateTime, JSON
from sqlalchemy.ext.declarative import declarative_base

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

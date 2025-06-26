from sqlalchemy import Column, String, DateTime, Integer
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

"""Alembic looked too heavy handed to me."""

import logging

from forecastbox.config import config
from sqlalchemy import MetaData, create_engine, text

logger = logging.getLogger(__name__)

def _migrate_jobs():
    url = f"sqlite:///{config.db.sqlite_jobdb_path}"
    engine = create_engine(url)
    metadata = MetaData()
    metadata.reflect(bind=engine)

    table = metadata.tables['job_records']
    logger.debug(f"considering migrations of {table=}")

    if 'progress' not in table.c:
        with engine.connect() as connection:
            logger.debug("adding column to jobs: progress")
            connection.execute(text("alter table job_records add column progress varchar(255)"))


def migrate():
    _migrate_jobs()

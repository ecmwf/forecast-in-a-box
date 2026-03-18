"""Alembic looked too heavy handed to me."""

# NOTE this file is left in place only as an example how to add migrations -- all these listed are currently invalid

import logging

from sqlalchemy import MetaData, create_engine, text

from forecastbox.config import config

logger = logging.getLogger(__name__)


def _migrate_jobs(metadata, connection):
    table = metadata.tables["job_records"]
    logger.debug(f"considering migrations of {table=}")

    if "progress" not in table.c:
        logger.debug("adding column to jobs: progress")
        connection.execute(text("alter table job_records add column progress varchar(255)"))


def _delete_models(metadata, connection):
    old_tables = ["model_downloads", "model_edits"]
    for table in old_tables:
        logger.debug(f"considering migrations of {table=}")
        if table in metadata.tables:
            logger.debug(f"will drop {table=}")
            connection.execute(text(f"drop table {table}"))


def migrate():
    return  # NOTE those migrations are invalid for now
    url = f"sqlite:///{config.db.sqlite_jobdb_path}"
    engine = create_engine(url)
    metadata = MetaData()
    metadata.reflect(bind=engine)
    with engine.connect() as connection:
        _migrate_jobs(metadata, connection)
        _delete_models(metadata, connection)

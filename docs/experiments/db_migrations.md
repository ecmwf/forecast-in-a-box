# Alembic
looked too heavy handed to me, and more "server-oriented" whereas we deal with end-station deployed software

# Manual
Each schema change would be manually extracted as respective sql statement, and put in place.

Ideally, it would execute changes based on versions (and version persistence would follow these updates transactionally),
so that we don't need to determine the state of db across versions.

Example:
```
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


def _add_experiment_context(metadata: MetaData, connection) -> None:  # type: ignore[no-untyped-def]
    if "job_execution" in metadata.tables and "experiment_context" not in metadata.tables["job_execution"].c:
        logger.debug("adding column to job_execution: experiment_context")
        connection.execute(text("ALTER TABLE job_execution ADD COLUMN experiment_context VARCHAR(255)"))
        connection.commit()


def migrate() -> None:
    url = f"sqlite:///{config.db.sqlite_jobdb_path}"
    engine = create_engine(url)
    metadata = MetaData()
    metadata.reflect(bind=engine)
    with engine.connect() as connection:
        _add_experiment_context(metadata, connection)
```

and then call `migrate()` in the startup.

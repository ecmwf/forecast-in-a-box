# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Shared engine/session setup for the jobs database.

The actual ORM models live in per-domain modules in this package (``blueprint.py``,
``experiment.py``, ``glyphs.py``, ``lens.py``, ``plugin.py``, ``run.py``), all of which
import ``Base`` from here so that every table is registered on the same ``MetaData``
instance. This is required, not just cosmetic: several tables (e.g. ``ExperimentDefinition``,
``Run``) declare ``ForeignKeyConstraint``s referencing ``blueprint`` by table name, and
SQLAlchemy resolves those string-based references against the referencing table's own
``MetaData`` registry -- so all of them must share this single ``Base``.

Exposes ``create_db_and_tables`` so the entrypoint can discover and run it via automatic
schemata iteration. See ``entrypoint/app.py`` for why it defers calling any discovered
``create_db_and_tables`` until *all* schemata submodules have been imported: only then is
it guaranteed that every ORM class in this package has registered its table on this
module's ``Base.metadata``.
# TODO for later: implement garbage collection
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from forecastbox.utility.config import config


class Base(DeclarativeBase):
    pass


sync_url = f"sqlite:///{config.db.sqlite_jobdb_path}"
sync_engine = create_engine(
    sync_url,
    pool_pre_ping=True,
    connect_args={"check_same_thread": False},
)
sync_session_maker = sessionmaker(sync_engine, expire_on_commit=False)


def create_db_and_tables() -> None:
    """Create the jobs database and all its tables on startup.

    Relies on every per-domain schemata module having already been imported (and thus
    having registered its ORM classes on ``Base.metadata``) by the time this is called --
    see the entrypoint's schemata discovery for how that is guaranteed.
    """
    Base.metadata.create_all(sync_engine)

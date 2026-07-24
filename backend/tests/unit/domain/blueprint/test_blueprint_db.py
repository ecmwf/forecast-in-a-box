# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for domain/blueprint/db.py helpers."""

from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import forecastbox.domain.blueprint.db as blueprint_db
import forecastbox.schemata.jobs as _jobs_module
from forecastbox.schemata.jobs import Base
from forecastbox.utility.auth import AuthContext


@pytest.fixture
def mem_session_maker(monkeypatch: pytest.MonkeyPatch) -> Iterator[sessionmaker[Session]]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    maker = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(_jobs_module, "session_maker", maker)
    monkeypatch.setattr(blueprint_db._jobs_module, "session_maker", maker)
    yield maker
    engine.dispose()


@pytest.mark.asyncio
async def test_soft_delete_plugin_template_marks_matching_rows(mem_session_maker: sessionmaker[Session]) -> None:
    """soft_delete_plugin_template marks all matching (created_by, display_name) rows as deleted."""
    auth = AuthContext(user_id="store:plugin", is_admin=True)
    blueprint_db.upsert_blueprint(
        auth_context=auth,
        source="plugin_template",
        created_by="store:plugin",
        display_name="myTemplate",
        display_description="desc",
    )

    rows_before = blueprint_db.find_plugin_template_id(created_by="store:plugin", display_name="myTemplate")
    assert rows_before is not None

    blueprint_db.soft_delete_plugin_template(created_by="store:plugin", display_name="myTemplate")

    rows_after = blueprint_db.find_plugin_template_id(created_by="store:plugin", display_name="myTemplate")
    assert rows_after is None, "After soft-delete the row should not be visible"


@pytest.mark.asyncio
async def test_soft_delete_plugin_template_does_not_affect_other_plugins(
    mem_session_maker: sessionmaker[Session],
) -> None:
    """soft_delete_plugin_template only touches rows owned by the specified plugin."""
    auth_a = AuthContext(user_id="storeA:plugin", is_admin=True)
    auth_b = AuthContext(user_id="storeB:plugin", is_admin=True)
    blueprint_db.upsert_blueprint(
        auth_context=auth_a,
        source="plugin_template",
        created_by="storeA:plugin",
        display_name="shared",
        display_description="from A",
    )
    blueprint_db.upsert_blueprint(
        auth_context=auth_b,
        source="plugin_template",
        created_by="storeB:plugin",
        display_name="shared",
        display_description="from B",
    )

    blueprint_db.soft_delete_plugin_template(created_by="storeA:plugin", display_name="shared")

    assert blueprint_db.find_plugin_template_id(created_by="storeA:plugin", display_name="shared") is None
    assert blueprint_db.find_plugin_template_id(created_by="storeB:plugin", display_name="shared") is not None

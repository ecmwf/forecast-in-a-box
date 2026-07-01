# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for domain/blueprint/db.py helpers."""

from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import forecastbox.domain.blueprint.db as blueprint_db
import forecastbox.schemata.jobs as _jobs_module
from forecastbox.schemata.jobs import Base
from forecastbox.utility.auth import AuthContext


@pytest_asyncio.fixture
async def mem_session_maker(monkeypatch: pytest.MonkeyPatch) -> AsyncGenerator[async_sessionmaker[AsyncSession], None]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(_jobs_module, "async_session_maker", maker)
    monkeypatch.setattr(blueprint_db._jobs_module, "async_session_maker", maker)
    yield maker
    await engine.dispose()


@pytest.mark.asyncio
async def test_soft_delete_plugin_template_marks_matching_rows(mem_session_maker: async_sessionmaker[AsyncSession]) -> None:
    """soft_delete_plugin_template marks all matching (created_by, display_name) rows as deleted."""
    auth = AuthContext(user_id="store:plugin", is_admin=True)
    await blueprint_db.upsert_blueprint(
        auth_context=auth,
        source="plugin_template",
        created_by="store:plugin",
        display_name="myTemplate",
        display_description="desc",
    )

    rows_before = await blueprint_db.find_plugin_template_id(created_by="store:plugin", display_name="myTemplate")
    assert rows_before is not None

    await blueprint_db.soft_delete_plugin_template(created_by="store:plugin", display_name="myTemplate")

    rows_after = await blueprint_db.find_plugin_template_id(created_by="store:plugin", display_name="myTemplate")
    assert rows_after is None, "After soft-delete the row should not be visible"


@pytest.mark.asyncio
async def test_soft_delete_plugin_template_does_not_affect_other_plugins(
    mem_session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """soft_delete_plugin_template only touches rows owned by the specified plugin."""
    auth_a = AuthContext(user_id="storeA:plugin", is_admin=True)
    auth_b = AuthContext(user_id="storeB:plugin", is_admin=True)
    await blueprint_db.upsert_blueprint(
        auth_context=auth_a,
        source="plugin_template",
        created_by="storeA:plugin",
        display_name="shared",
        display_description="from A",
    )
    await blueprint_db.upsert_blueprint(
        auth_context=auth_b,
        source="plugin_template",
        created_by="storeB:plugin",
        display_name="shared",
        display_description="from B",
    )

    await blueprint_db.soft_delete_plugin_template(created_by="storeA:plugin", display_name="shared")

    assert await blueprint_db.find_plugin_template_id(created_by="storeA:plugin", display_name="shared") is None
    assert await blueprint_db.find_plugin_template_id(created_by="storeB:plugin", display_name="shared") is not None

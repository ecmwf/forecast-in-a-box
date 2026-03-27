# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the jobs schema and CRUD helpers.

All tests use an in-memory SQLite engine so no filesystem state is required.
``forecastbox.db.jobs.async_session_maker`` is monkeypatched to the in-memory
maker for ExperimentDefinition / JobExecution / ExperimentNext tests.

JobDefinition tests additionally patch
``forecastbox.domain.definition.db._jobs_module.async_session_maker``; both
patches are applied together via the ``mem_session_maker_both`` fixture so that
FK constraints between tables still work.
"""

import datetime as dt

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import forecastbox.db.jobs as jobs_db
import forecastbox.domain.job_definition.db as job_definition_db
from forecastbox.domain.job_definition.db import ActorContext
from forecastbox.domain.job_definition.exceptions import JobDefinitionAccessDenied, JobDefinitionNotFound
from forecastbox.schemas.jobs import Base


@pytest_asyncio.fixture
async def mem_session_maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    yield maker
    await engine.dispose()


@pytest_asyncio.fixture
async def mem_session_maker_both(mem_session_maker, monkeypatch):
    """Patch both jobs_db and job_definition_db to the same in-memory session maker."""
    monkeypatch.setattr(jobs_db, "async_session_maker", mem_session_maker)
    # job_definition_db accesses _jobs_module.async_session_maker; patch via the
    # module reference that job_definition_db holds.
    monkeypatch.setattr(job_definition_db._jobs_module, "async_session_maker", mem_session_maker)
    yield mem_session_maker


_admin = ActorContext(user_id="admin", is_admin=True)
_user1 = ActorContext(user_id="user1", is_admin=False)
_user2 = ActorContext(user_id="user2", is_admin=False)
_anon = ActorContext(user_id=None, is_admin=False)


# ---------------------------------------------------------------------------
# JobDefinition
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_jobs_job_definition_insert_and_get(mem_session_maker_both):
    job_id, v1 = await job_definition_db.upsert_job_definition(
        actor=_user1,
        source="user_defined",
        created_by="user1",
        display_name="My job",
        blocks={"source1": {}},
        tags=["tag1"],
    )
    assert v1 == 1

    result = await job_definition_db.get_job_definition(job_id)
    assert result is not None
    assert result.job_definition_id == job_id
    assert result.version == 1
    assert result.source == "user_defined"
    assert result.display_name == "My job"
    assert result.tags == ["tag1"]


@pytest.mark.asyncio
async def test_jobs_job_definition_latest_version(mem_session_maker_both):
    job_id, v1 = await job_definition_db.upsert_job_definition(actor=_user1, source="user_defined", created_by="user1")
    _, v2 = await job_definition_db.upsert_job_definition(actor=_user1, definition_id=job_id, source="user_defined", created_by="user1")
    _, v3 = await job_definition_db.upsert_job_definition(actor=_user1, definition_id=job_id, source="user_defined", created_by="user1")

    assert v1 == 1
    assert v2 == 2
    assert v3 == 3

    latest = await job_definition_db.get_job_definition(job_id)
    assert latest is not None
    assert latest.version == 3

    specific = await job_definition_db.get_job_definition(job_id, version=1)
    assert specific is not None
    assert specific.version == 1


@pytest.mark.asyncio
async def test_jobs_job_definition_soft_delete(mem_session_maker_both):
    job_id, _ = await job_definition_db.upsert_job_definition(actor=_user1, source="user_defined", created_by="user1")

    await job_definition_db.soft_delete_job_definition(job_id, actor=_user1)

    assert await job_definition_db.get_job_definition(job_id) is None

    definitions = list(await job_definition_db.list_job_definitions(actor=_admin))
    assert all(d.job_definition_id != job_id for d in definitions)


@pytest.mark.asyncio
async def test_jobs_list_job_definitions_latest_only(mem_session_maker_both):
    job_id, _ = await job_definition_db.upsert_job_definition(actor=_user1, source="user_defined", created_by="user1")
    await job_definition_db.upsert_job_definition(actor=_user1, definition_id=job_id, source="user_defined", created_by="user1")
    await job_definition_db.upsert_job_definition(actor=_user1, definition_id=job_id, source="user_defined", created_by="user1")

    other_id, _ = await job_definition_db.upsert_job_definition(actor=_user2, source="oneoff_execution", created_by="user2")

    definitions = list(await job_definition_db.list_job_definitions(actor=_admin))
    ids = [d.job_definition_id for d in definitions]
    assert job_id in ids
    assert other_id in ids

    matching = [d for d in definitions if d.job_definition_id == job_id]
    assert len(matching) == 1
    assert matching[0].version == 3


@pytest.mark.asyncio
async def test_jobs_list_job_definitions_ownership_filter(mem_session_maker_both):
    """Non-admin users see only their own definitions and plugin templates."""
    id_u1, _ = await job_definition_db.upsert_job_definition(actor=_user1, source="user_defined", created_by="user1")
    id_u2, _ = await job_definition_db.upsert_job_definition(actor=_user2, source="user_defined", created_by="user2")
    id_tmpl, _ = await job_definition_db.upsert_job_definition(actor=_admin, source="plugin_template", created_by="admin")

    u1_defs = {d.job_definition_id for d in await job_definition_db.list_job_definitions(actor=_user1)}
    assert id_u1 in u1_defs
    assert id_tmpl in u1_defs
    assert id_u2 not in u1_defs

    anon_defs = {d.job_definition_id for d in await job_definition_db.list_job_definitions(actor=_anon)}
    assert id_tmpl in anon_defs
    assert id_u1 not in anon_defs

    admin_defs = {d.job_definition_id for d in await job_definition_db.list_job_definitions(actor=_admin)}
    assert {id_u1, id_u2, id_tmpl}.issubset(admin_defs)


@pytest.mark.asyncio
async def test_jobs_upsert_job_definition_unknown_id_raises(mem_session_maker_both):
    with pytest.raises(JobDefinitionNotFound):
        await job_definition_db.upsert_job_definition(
            actor=_user1, definition_id="nonexistent-id", source="user_defined", created_by="user1"
        )


@pytest.mark.asyncio
async def test_jobs_upsert_job_definition_wrong_owner_raises(mem_session_maker_both):
    """Non-owner cannot update a definition they don't own."""
    job_id, _ = await job_definition_db.upsert_job_definition(actor=_user1, source="user_defined", created_by="user1")

    with pytest.raises(JobDefinitionAccessDenied):
        await job_definition_db.upsert_job_definition(
            actor=_user2,
            definition_id=job_id,
            source="user_defined",
            created_by="user2",
        )


@pytest.mark.asyncio
async def test_jobs_upsert_job_definition_admin_can_update_any(mem_session_maker_both):
    """Admin can update a definition owned by another user."""
    job_id, _ = await job_definition_db.upsert_job_definition(actor=_user1, source="user_defined", created_by="user1")

    _, v2 = await job_definition_db.upsert_job_definition(
        actor=_admin,
        definition_id=job_id,
        source="user_defined",
        created_by="admin",
    )
    assert v2 == 2


@pytest.mark.asyncio
async def test_jobs_soft_delete_wrong_owner_raises(mem_session_maker_both):
    """Non-owner cannot delete a definition they don't own."""
    job_id, _ = await job_definition_db.upsert_job_definition(actor=_user1, source="user_defined", created_by="user1")

    with pytest.raises(JobDefinitionAccessDenied):
        await job_definition_db.soft_delete_job_definition(job_id, actor=_user2)


@pytest.mark.asyncio
async def test_jobs_soft_delete_not_found_raises(mem_session_maker_both):
    with pytest.raises(JobDefinitionNotFound):
        await job_definition_db.soft_delete_job_definition("no-such-id", actor=_admin)


# ---------------------------------------------------------------------------
# ExperimentDefinition
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_jobs_experiment_definition_versioning(mem_session_maker_both):
    job_id, job_v = await job_definition_db.upsert_job_definition(actor=_user1, source="user_defined", created_by="user1")

    exp_id, v1 = await jobs_db.upsert_experiment_definition(
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by="user1",
        experiment_definition={"cron": "0 * * * *"},
    )
    assert v1 == 1

    _, v2 = await jobs_db.upsert_experiment_definition(
        experiment_definition_id=exp_id,
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by="user1",
        experiment_definition={"cron": "30 * * * *"},
    )
    assert v2 == 2

    latest = await jobs_db.get_experiment_definition(exp_id)
    assert latest is not None
    assert latest.version == 2
    assert latest.experiment_definition == {"cron": "30 * * * *"}


@pytest.mark.asyncio
async def test_jobs_experiment_definition_soft_delete(mem_session_maker_both):
    job_id, job_v = await job_definition_db.upsert_job_definition(actor=_user1, source="user_defined", created_by="user1")
    exp_id, _ = await jobs_db.upsert_experiment_definition(
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by="user1",
    )

    await jobs_db.soft_delete_experiment_definition(exp_id)

    assert await jobs_db.get_experiment_definition(exp_id) is None
    experiments = list(await jobs_db.list_experiment_definitions())
    assert all(e.experiment_definition_id != exp_id for e in experiments)


# ---------------------------------------------------------------------------
# JobExecution
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_jobs_job_execution_latest_attempt(mem_session_maker_both):
    job_id, job_v = await job_definition_db.upsert_job_definition(actor=_user1, source="user_defined", created_by="user1")

    exec_id, a1 = await jobs_db.upsert_job_execution(
        job_definition_id=job_id,
        job_definition_version=job_v,
        created_by="user1",
        status="submitted",
    )
    assert a1 == 1

    _, a2 = await jobs_db.upsert_job_execution(
        job_execution_id=exec_id,
        job_definition_id=job_id,
        job_definition_version=job_v,
        created_by="user1",
        status="submitted",
    )
    assert a2 == 2

    # Latest attempt returned by default
    latest = await jobs_db.get_job_execution(exec_id)
    assert latest is not None
    assert latest.attempt_count == 2

    # Explicit attempt lookup works
    first = await jobs_db.get_job_execution(exec_id, attempt_count=1)
    assert first is not None
    assert first.attempt_count == 1


@pytest.mark.asyncio
async def test_jobs_update_job_execution_runtime(mem_session_maker_both):
    job_id, job_v = await job_definition_db.upsert_job_definition(actor=_user1, source="user_defined", created_by="user1")
    exec_id, attempt = await jobs_db.upsert_job_execution(
        job_definition_id=job_id,
        job_definition_version=job_v,
        created_by="user1",
        status="submitted",
    )

    await jobs_db.update_job_execution_runtime(
        exec_id, attempt, status="success", cascade_job_id="job-abc", outputs={"url": "s3://bucket/out"}
    )

    execution = await jobs_db.get_job_execution(exec_id, attempt_count=attempt)
    assert execution is not None
    assert execution.status == "success"
    assert execution.cascade_job_id == "job-abc"
    assert execution.outputs == {"url": "s3://bucket/out"}


@pytest.mark.asyncio
async def test_jobs_job_execution_soft_delete(mem_session_maker_both):
    job_id, job_v = await job_definition_db.upsert_job_definition(actor=_user1, source="user_defined", created_by="user1")
    exec_id, _ = await jobs_db.upsert_job_execution(
        job_definition_id=job_id,
        job_definition_version=job_v,
        created_by="user1",
        status="submitted",
    )

    await jobs_db.soft_delete_job_execution(exec_id)

    assert await jobs_db.get_job_execution(exec_id) is None
    executions = list(await jobs_db.list_job_executions())
    assert all(e.job_execution_id != exec_id for e in executions)


@pytest.mark.asyncio
async def test_jobs_list_job_executions_latest_only(mem_session_maker_both):
    job_id, job_v = await job_definition_db.upsert_job_definition(actor=_user1, source="user_defined", created_by="user1")
    exec_id, _ = await jobs_db.upsert_job_execution(
        job_definition_id=job_id, job_definition_version=job_v, created_by="user1", status="submitted"
    )

    executions = list(await jobs_db.list_job_executions())
    matching = [e for e in executions if e.job_execution_id == exec_id]
    assert len(matching) == 1
    assert matching[0].attempt_count == 1


# ---------------------------------------------------------------------------
# ExperimentNext
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_jobs_experiment_next_upsert(mem_session_maker_both):
    job_id, job_v = await job_definition_db.upsert_job_definition(actor=_user1, source="user_defined", created_by="user1")
    exp_id, _ = await jobs_db.upsert_experiment_definition(
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by="user1",
    )

    t1 = dt.datetime(2026, 1, 1, 12, 0)
    await jobs_db.upsert_experiment_next(experiment_id=exp_id, scheduled_at=t1)

    result = await jobs_db.get_experiment_next(exp_id)
    assert result is not None
    assert result.scheduled_at == t1

    # Upsert again should update the scheduled_at
    t2 = dt.datetime(2026, 1, 2, 12, 0)
    await jobs_db.upsert_experiment_next(experiment_id=exp_id, scheduled_at=t2)

    result2 = await jobs_db.get_experiment_next(exp_id)
    assert result2 is not None
    assert result2.scheduled_at == t2

    # Only one row per experiment_id
    assert result2.experiment_next_id == result.experiment_next_id


# ---------------------------------------------------------------------------
# id-provided guard (ExperimentDefinition and JobExecution only;
# JobDefinition guard is covered in the auth tests above)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_jobs_upsert_experiment_definition_unknown_id_raises(mem_session_maker_both):
    job_id, job_v = await job_definition_db.upsert_job_definition(actor=_user1, source="user_defined", created_by="user1")

    with pytest.raises(KeyError, match="No ExperimentDefinition"):
        await jobs_db.upsert_experiment_definition(
            experiment_definition_id="nonexistent-id",
            job_definition_id=job_id,
            job_definition_version=job_v,
            experiment_type="cron_schedule",
            created_by="user1",
        )


@pytest.mark.asyncio
async def test_jobs_upsert_job_execution_unknown_id_raises(mem_session_maker_both):
    job_id, job_v = await job_definition_db.upsert_job_definition(actor=_user1, source="user_defined", created_by="user1")

    with pytest.raises(KeyError, match="No JobExecution"):
        await jobs_db.upsert_job_execution(
            job_execution_id="nonexistent-id",
            job_definition_id=job_id,
            job_definition_version=job_v,
            created_by="user1",
            status="submitted",
        )

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

JobDefinition, ExperimentDefinition, ExperimentNext, and JobExecution tests
patch the corresponding domain-module ``_jobs_module.async_session_maker``
references so that all tables share a single connection pool and FK constraints
work in-memory.  The ``mem_session_maker_all`` fixture applies all patches at once.
"""

import datetime as dt

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import forecastbox.db.jobs as jobs_db
import forecastbox.domain.experiment.db as experiment_db
import forecastbox.domain.experiment.scheduling.db as scheduling_db
import forecastbox.domain.job_definition.db as job_definition_db
import forecastbox.domain.job_execution.db as job_execution_db
from forecastbox.domain.experiment.exceptions import ExperimentAccessDenied, ExperimentNotFound
from forecastbox.domain.job_definition.exceptions import JobDefinitionAccessDenied, JobDefinitionNotFound
from forecastbox.domain.job_execution.exceptions import JobExecutionAccessDenied, JobExecutionNotFound
from forecastbox.schemas.jobs import Base
from forecastbox.utility.auth import AuthContext


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
    """Patch jobs_db, job_definition_db, experiment_db, scheduling_db, and job_execution_db to the same in-memory session maker."""
    monkeypatch.setattr(jobs_db, "async_session_maker", mem_session_maker)
    monkeypatch.setattr(job_definition_db._jobs_module, "async_session_maker", mem_session_maker)
    monkeypatch.setattr(experiment_db._jobs_module, "async_session_maker", mem_session_maker)
    monkeypatch.setattr(scheduling_db._jobs_module, "async_session_maker", mem_session_maker)
    monkeypatch.setattr(job_execution_db._jobs_module, "async_session_maker", mem_session_maker)
    yield mem_session_maker


# alias for clarity in newer tests
mem_session_maker_all = mem_session_maker_both


_admin = AuthContext(user_id="admin", is_admin=True)
_user1 = AuthContext(user_id="user1", is_admin=False)
_user2 = AuthContext(user_id="user2", is_admin=False)
_anon = AuthContext(user_id=None, is_admin=False)


# ---------------------------------------------------------------------------
# JobDefinition
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_jobs_job_definition_insert_and_get(mem_session_maker_both):
    job_id, v1 = await job_definition_db.upsert_job_definition(
        auth_context=_user1,
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
    job_id, v1 = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
    _, v2 = await job_definition_db.upsert_job_definition(
        auth_context=_user1, definition_id=job_id, source="user_defined", created_by="user1"
    )
    _, v3 = await job_definition_db.upsert_job_definition(
        auth_context=_user1, definition_id=job_id, source="user_defined", created_by="user1"
    )

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
    job_id, _ = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")

    await job_definition_db.soft_delete_job_definition(job_id, expected_version=1, auth_context=_user1)

    assert await job_definition_db.get_job_definition(job_id) is None

    definitions = list(await job_definition_db.list_job_definitions(auth_context=_admin))
    assert all(d.job_definition_id != job_id for d in definitions)


@pytest.mark.asyncio
async def test_jobs_list_job_definitions_latest_only(mem_session_maker_both):
    job_id, _ = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
    await job_definition_db.upsert_job_definition(auth_context=_user1, definition_id=job_id, source="user_defined", created_by="user1")
    await job_definition_db.upsert_job_definition(auth_context=_user1, definition_id=job_id, source="user_defined", created_by="user1")

    other_id, _ = await job_definition_db.upsert_job_definition(auth_context=_user2, source="oneoff_execution", created_by="user2")

    definitions = list(await job_definition_db.list_job_definitions(auth_context=_admin))
    ids = [d.job_definition_id for d in definitions]
    assert job_id in ids
    assert other_id in ids

    matching = [d for d in definitions if d.job_definition_id == job_id]
    assert len(matching) == 1
    assert matching[0].version == 3


@pytest.mark.asyncio
async def test_jobs_list_job_definitions_ownership_filter(mem_session_maker_both):
    """Non-admin users see only their own definitions and plugin templates."""
    id_u1, _ = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
    id_u2, _ = await job_definition_db.upsert_job_definition(auth_context=_user2, source="user_defined", created_by="user2")
    id_tmpl, _ = await job_definition_db.upsert_job_definition(auth_context=_admin, source="plugin_template", created_by="admin")

    u1_defs = {d.job_definition_id for d in await job_definition_db.list_job_definitions(auth_context=_user1)}
    assert id_u1 in u1_defs
    assert id_tmpl in u1_defs
    assert id_u2 not in u1_defs

    anon_defs = {d.job_definition_id for d in await job_definition_db.list_job_definitions(auth_context=_anon)}
    assert id_u1 in anon_defs
    assert id_u2 in anon_defs
    assert id_tmpl in anon_defs

    admin_defs = {d.job_definition_id for d in await job_definition_db.list_job_definitions(auth_context=_admin)}
    assert {id_u1, id_u2, id_tmpl}.issubset(admin_defs)


@pytest.mark.asyncio
async def test_jobs_upsert_job_definition_unknown_id_raises(mem_session_maker_both):
    with pytest.raises(JobDefinitionNotFound):
        await job_definition_db.upsert_job_definition(
            auth_context=_user1, definition_id="nonexistent-id", source="user_defined", created_by="user1"
        )


@pytest.mark.asyncio
async def test_jobs_upsert_job_definition_wrong_owner_raises(mem_session_maker_both):
    """Non-owner cannot update a definition they don't own."""
    job_id, _ = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")

    with pytest.raises(JobDefinitionAccessDenied):
        await job_definition_db.upsert_job_definition(
            auth_context=_user2,
            definition_id=job_id,
            source="user_defined",
            created_by="user2",
        )


@pytest.mark.asyncio
async def test_jobs_upsert_job_definition_admin_can_update_any(mem_session_maker_both):
    """Admin can update a definition owned by another user."""
    job_id, _ = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")

    _, v2 = await job_definition_db.upsert_job_definition(
        auth_context=_admin,
        definition_id=job_id,
        source="user_defined",
        created_by="admin",
    )
    assert v2 == 2


@pytest.mark.asyncio
async def test_jobs_soft_delete_wrong_owner_raises(mem_session_maker_both):
    """Non-owner cannot delete a definition they don't own."""
    job_id, _ = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")

    with pytest.raises(JobDefinitionAccessDenied):
        await job_definition_db.soft_delete_job_definition(job_id, expected_version=1, auth_context=_user2)


@pytest.mark.asyncio
async def test_jobs_soft_delete_not_found_raises(mem_session_maker_both):
    with pytest.raises(JobDefinitionNotFound):
        await job_definition_db.soft_delete_job_definition("no-such-id", expected_version=1, auth_context=_admin)


# ---------------------------------------------------------------------------
# ExperimentDefinition
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_jobs_experiment_definition_versioning(mem_session_maker_both):
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")

    exp_id, v1 = await experiment_db.upsert_experiment_definition(
        auth_context=_user1,
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by="user1",
        experiment_definition={"cron": "0 * * * *"},
    )
    assert v1 == 1

    _, v2 = await experiment_db.upsert_experiment_definition(
        auth_context=_user1,
        experiment_definition_id=exp_id,
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by="user1",
        experiment_definition={"cron": "30 * * * *"},
    )
    assert v2 == 2

    latest = await experiment_db.get_experiment_definition(exp_id)
    assert latest is not None
    assert latest.version == 2
    assert latest.experiment_definition == {"cron": "30 * * * *"}


@pytest.mark.asyncio
async def test_jobs_experiment_definition_soft_delete(mem_session_maker_both):
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
    exp_id, _ = await experiment_db.upsert_experiment_definition(
        auth_context=_user1,
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by="user1",
    )

    await experiment_db.soft_delete_experiment_definition(exp_id, auth_context=_user1)

    assert await experiment_db.get_experiment_definition(exp_id) is None
    experiments = list(await experiment_db.list_experiment_definitions(auth_context=_admin))
    assert all(e.experiment_definition_id != exp_id for e in experiments)


@pytest.mark.asyncio
async def test_experiment_create_anon_allowed(mem_session_maker_both):
    """Passthrough (user_id=None) callers may create experiments; created_by is stored as None."""
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
    exp_id, v1 = await experiment_db.upsert_experiment_definition(
        auth_context=_anon,
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by=None,
    )
    assert v1 == 1
    result = await experiment_db.get_experiment_definition(exp_id)
    assert result is not None
    assert result.created_by is None


@pytest.mark.asyncio
async def test_experiment_update_non_owner_raises(mem_session_maker_both):
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
    exp_id, _ = await experiment_db.upsert_experiment_definition(
        auth_context=_user1,
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by="user1",
    )
    with pytest.raises(ExperimentAccessDenied):
        await experiment_db.upsert_experiment_definition(
            auth_context=_user2,
            experiment_definition_id=exp_id,
            job_definition_id=job_id,
            job_definition_version=job_v,
            experiment_type="cron_schedule",
            created_by="user2",
        )


@pytest.mark.asyncio
async def test_experiment_update_admin_bypasses_ownership(mem_session_maker_both):
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
    exp_id, _ = await experiment_db.upsert_experiment_definition(
        auth_context=_user1,
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by="user1",
    )
    _, v2 = await experiment_db.upsert_experiment_definition(
        auth_context=_admin,
        experiment_definition_id=exp_id,
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by="user1",
    )
    assert v2 == 2


@pytest.mark.asyncio
async def test_experiment_delete_non_owner_raises(mem_session_maker_both):
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
    exp_id, _ = await experiment_db.upsert_experiment_definition(
        auth_context=_user1,
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by="user1",
    )
    with pytest.raises(ExperimentAccessDenied):
        await experiment_db.soft_delete_experiment_definition(exp_id, auth_context=_user2)


@pytest.mark.asyncio
async def test_experiment_list_filters_by_actor(mem_session_maker_both):
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")

    await experiment_db.upsert_experiment_definition(
        auth_context=_user1,
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by="user1",
    )
    await experiment_db.upsert_experiment_definition(
        auth_context=_user2,
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by="user2",
    )

    user1_exps = list(await experiment_db.list_experiment_definitions(auth_context=_user1))
    user2_exps = list(await experiment_db.list_experiment_definitions(auth_context=_user2))
    admin_exps = list(await experiment_db.list_experiment_definitions(auth_context=_admin))
    anon_exps = list(await experiment_db.list_experiment_definitions(auth_context=_anon))

    assert len(user1_exps) == 1 and user1_exps[0].created_by == "user1"
    assert len(user2_exps) == 1 and user2_exps[0].created_by == "user2"
    assert len(admin_exps) == 2
    assert len(anon_exps) == 2


# ---------------------------------------------------------------------------
# Passthrough / anonymous regime (user_id=None) — treated as admin
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_anon_list_job_definitions_sees_all(mem_session_maker_both):
    """Passthrough caller sees all job definitions, not only plugin templates."""
    id_u1, _ = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
    id_u2, _ = await job_definition_db.upsert_job_definition(auth_context=_user2, source="user_defined", created_by="user2")
    id_tmpl, _ = await job_definition_db.upsert_job_definition(auth_context=_admin, source="plugin_template", created_by="admin")

    anon_defs = {d.job_definition_id for d in await job_definition_db.list_job_definitions(auth_context=_anon)}
    assert {id_u1, id_u2, id_tmpl}.issubset(anon_defs)


@pytest.mark.asyncio
async def test_anon_update_job_definition_bypasses_ownership(mem_session_maker_both):
    """Passthrough caller may update a job definition owned by another user."""
    job_id, _ = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
    _, v2 = await job_definition_db.upsert_job_definition(
        auth_context=_anon,
        definition_id=job_id,
        source="user_defined",
        created_by=None,
    )
    assert v2 == 2


@pytest.mark.asyncio
async def test_anon_list_experiments_sees_all(mem_session_maker_both):
    """Passthrough caller sees all experiments, not an empty result."""
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
    await experiment_db.upsert_experiment_definition(
        auth_context=_user1,
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by="user1",
    )
    await experiment_db.upsert_experiment_definition(
        auth_context=_user2,
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by="user2",
    )
    anon_exps = list(await experiment_db.list_experiment_definitions(auth_context=_anon))
    assert len(anon_exps) == 2


@pytest.mark.asyncio
async def test_anon_update_experiment_bypasses_ownership(mem_session_maker_both):
    """Passthrough caller may update an experiment owned by another user."""
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
    exp_id, _ = await experiment_db.upsert_experiment_definition(
        auth_context=_user1,
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by="user1",
    )
    _, v2 = await experiment_db.upsert_experiment_definition(
        auth_context=_anon,
        experiment_definition_id=exp_id,
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by=None,
    )
    assert v2 == 2


@pytest.mark.asyncio
async def test_anon_delete_experiment_bypasses_ownership(mem_session_maker_both):
    """Passthrough caller may delete an experiment owned by another user."""
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
    exp_id, _ = await experiment_db.upsert_experiment_definition(
        auth_context=_user1,
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by="user1",
    )
    await experiment_db.soft_delete_experiment_definition(exp_id, auth_context=_anon)
    assert await experiment_db.get_experiment_definition(exp_id) is None


# ---------------------------------------------------------------------------
# JobExecution
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_jobs_job_execution_latest_attempt(mem_session_maker_both):
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")

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
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
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
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
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
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
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
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
    exp_id, _ = await experiment_db.upsert_experiment_definition(
        auth_context=_user1,
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by="user1",
    )

    t1 = dt.datetime(2026, 1, 1, 12, 0)
    await scheduling_db.upsert_experiment_next(experiment_id=exp_id, scheduled_at=t1)

    result = await scheduling_db.get_experiment_next(exp_id)
    assert result is not None
    assert result.scheduled_at == t1

    # Upsert again should update the scheduled_at
    t2 = dt.datetime(2026, 1, 2, 12, 0)
    await scheduling_db.upsert_experiment_next(experiment_id=exp_id, scheduled_at=t2)

    result2 = await scheduling_db.get_experiment_next(exp_id)
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
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")

    with pytest.raises(ExperimentNotFound):
        await experiment_db.upsert_experiment_definition(
            auth_context=_user1,
            experiment_definition_id="nonexistent-id",
            job_definition_id=job_id,
            job_definition_version=job_v,
            experiment_type="cron_schedule",
            created_by="user1",
        )


@pytest.mark.asyncio
async def test_jobs_upsert_job_execution_unknown_id_raises(mem_session_maker_both):
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")

    with pytest.raises(KeyError, match="No JobExecution"):
        await jobs_db.upsert_job_execution(
            job_execution_id="nonexistent-id",
            job_definition_id=job_id,
            job_definition_version=job_v,
            created_by="user1",
            status="submitted",
        )


# ---------------------------------------------------------------------------
# JobExecution — auth / ownership tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_job_execution_get_own(mem_session_maker_both):
    """Owner can retrieve their own execution."""
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
    exec_id, _ = await job_execution_db.upsert_job_execution(
        job_definition_id=job_id, job_definition_version=job_v, created_by="user1", status="submitted"
    )
    result = await job_execution_db.get_job_execution(exec_id, auth_context=_user1)
    assert result is not None
    assert result.job_execution_id == exec_id


@pytest.mark.asyncio
async def test_job_execution_get_other_user_denied(mem_session_maker_both):
    """Non-owner cannot access another user's execution."""
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
    exec_id, _ = await job_execution_db.upsert_job_execution(
        job_definition_id=job_id, job_definition_version=job_v, created_by="user1", status="submitted"
    )
    with pytest.raises(JobExecutionAccessDenied):
        await job_execution_db.get_job_execution(exec_id, auth_context=_user2)


@pytest.mark.asyncio
async def test_job_execution_get_admin_sees_all(mem_session_maker_both):
    """Admin can access any execution."""
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
    exec_id, _ = await job_execution_db.upsert_job_execution(
        job_definition_id=job_id, job_definition_version=job_v, created_by="user1", status="submitted"
    )
    result = await job_execution_db.get_job_execution(exec_id, auth_context=_admin)
    assert result is not None


@pytest.mark.asyncio
async def test_job_execution_get_anon_sees_all(mem_session_maker_both):
    """Anonymous actor (unauthenticated regime) can access all executions."""
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
    exec_id, _ = await job_execution_db.upsert_job_execution(
        job_definition_id=job_id, job_definition_version=job_v, created_by="user1", status="submitted"
    )
    result = await job_execution_db.get_job_execution(exec_id, auth_context=_anon)
    assert result is not None


@pytest.mark.asyncio
async def test_job_execution_get_not_found(mem_session_maker_both):
    """get_job_execution raises JobExecutionNotFound for missing id."""
    with pytest.raises(JobExecutionNotFound):
        await job_execution_db.get_job_execution("nonexistent-id", auth_context=_admin)


@pytest.mark.asyncio
async def test_job_execution_list_filters_by_owner(mem_session_maker_both):
    """Non-admin users see only their own executions in list."""
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
    exec_u1, _ = await job_execution_db.upsert_job_execution(
        job_definition_id=job_id, job_definition_version=job_v, created_by="user1", status="submitted"
    )
    exec_u2, _ = await job_execution_db.upsert_job_execution(
        job_definition_id=job_id, job_definition_version=job_v, created_by="user2", status="submitted"
    )

    u1_execs = {e.job_execution_id for e in await job_execution_db.list_job_executions(auth_context=_user1)}
    assert exec_u1 in u1_execs
    assert exec_u2 not in u1_execs

    admin_execs = {e.job_execution_id for e in await job_execution_db.list_job_executions(auth_context=_admin)}
    assert exec_u1 in admin_execs
    assert exec_u2 in admin_execs


@pytest.mark.asyncio
async def test_job_execution_delete_own(mem_session_maker_both):
    """Owner can delete their own execution."""
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
    exec_id, _ = await job_execution_db.upsert_job_execution(
        job_definition_id=job_id, job_definition_version=job_v, created_by="user1", status="submitted"
    )
    await job_execution_db.soft_delete_job_execution(exec_id, auth_context=_user1)
    with pytest.raises(JobExecutionNotFound):
        await job_execution_db.get_job_execution(exec_id, auth_context=_admin)


@pytest.mark.asyncio
async def test_job_execution_delete_other_user_denied(mem_session_maker_both):
    """Non-owner cannot delete another user's execution."""
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
    exec_id, _ = await job_execution_db.upsert_job_execution(
        job_definition_id=job_id, job_definition_version=job_v, created_by="user1", status="submitted"
    )
    with pytest.raises(JobExecutionAccessDenied):
        await job_execution_db.soft_delete_job_execution(exec_id, auth_context=_user2)


@pytest.mark.asyncio
async def test_job_execution_delete_admin_can_delete_any(mem_session_maker_both):
    """Admin can delete any execution."""
    job_id, job_v = await job_definition_db.upsert_job_definition(auth_context=_user1, source="user_defined", created_by="user1")
    exec_id, _ = await job_execution_db.upsert_job_execution(
        job_definition_id=job_id, job_definition_version=job_v, created_by="user1", status="submitted"
    )
    await job_execution_db.soft_delete_job_execution(exec_id, auth_context=_admin)
    with pytest.raises(JobExecutionNotFound):
        await job_execution_db.get_job_execution(exec_id, auth_context=_admin)

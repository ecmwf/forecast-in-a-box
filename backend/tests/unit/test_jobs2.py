# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the jobs2 schema and CRUD helpers.

All tests use an in-memory SQLite engine so no filesystem state is required.
The module-level `async_session_maker` in `forecastbox.db.jobs2` is monkeypatched
to point at the in-memory session maker for each test.
"""

import datetime as dt

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import forecastbox.db.jobs2 as jobs2_db
from forecastbox.schemas.jobs2 import Base


@pytest_asyncio.fixture
async def mem_session_maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    yield maker
    await engine.dispose()


# ---------------------------------------------------------------------------
# JobDefinition
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_jobs2_job_definition_insert_and_get(mem_session_maker, monkeypatch):
    monkeypatch.setattr(jobs2_db, "async_session_maker", mem_session_maker)

    job_id, v1 = await jobs2_db.upsert_job_definition(
        source="user_defined",
        created_by="user1",
        display_name="My job",
        blocks={"source1": {}},
        tags=["tag1"],
    )
    assert v1 == 1

    result = await jobs2_db.get_job_definition(job_id)
    assert result is not None
    assert result.id == job_id
    assert result.version == 1
    assert result.source == "user_defined"
    assert result.display_name == "My job"
    assert result.tags == ["tag1"]


@pytest.mark.asyncio
async def test_jobs2_job_definition_latest_version(mem_session_maker, monkeypatch):
    monkeypatch.setattr(jobs2_db, "async_session_maker", mem_session_maker)

    job_id, v1 = await jobs2_db.upsert_job_definition(source="user_defined", created_by="user1")
    _, v2 = await jobs2_db.upsert_job_definition(id=job_id, source="user_defined", created_by="user1")
    _, v3 = await jobs2_db.upsert_job_definition(id=job_id, source="user_defined", created_by="user1")

    assert v1 == 1
    assert v2 == 2
    assert v3 == 3

    # Latest version returned when no explicit version given
    latest = await jobs2_db.get_job_definition(job_id)
    assert latest is not None
    assert latest.version == 3

    # Explicit version lookup still works
    specific = await jobs2_db.get_job_definition(job_id, version=1)
    assert specific is not None
    assert specific.version == 1


@pytest.mark.asyncio
async def test_jobs2_job_definition_soft_delete(mem_session_maker, monkeypatch):
    monkeypatch.setattr(jobs2_db, "async_session_maker", mem_session_maker)

    job_id, _ = await jobs2_db.upsert_job_definition(source="user_defined", created_by="user1")

    await jobs2_db.soft_delete_job_definition(job_id)

    # Normal get excludes deleted rows
    assert await jobs2_db.get_job_definition(job_id) is None

    # List excludes deleted rows
    definitions = list(await jobs2_db.list_job_definitions())
    assert all(d.id != job_id for d in definitions)


@pytest.mark.asyncio
async def test_jobs2_list_job_definitions_latest_only(mem_session_maker, monkeypatch):
    monkeypatch.setattr(jobs2_db, "async_session_maker", mem_session_maker)

    job_id, _ = await jobs2_db.upsert_job_definition(source="user_defined", created_by="user1")
    await jobs2_db.upsert_job_definition(id=job_id, source="user_defined", created_by="user1")
    await jobs2_db.upsert_job_definition(id=job_id, source="user_defined", created_by="user1")

    # A second independent definition
    other_id, _ = await jobs2_db.upsert_job_definition(source="oneoff_execution", created_by="user2")

    definitions = list(await jobs2_db.list_job_definitions())
    ids = [d.id for d in definitions]
    assert job_id in ids
    assert other_id in ids

    # Only the latest version for job_id is returned
    matching = [d for d in definitions if d.id == job_id]
    assert len(matching) == 1
    assert matching[0].version == 3


# ---------------------------------------------------------------------------
# ExperimentDefinition
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_jobs2_experiment_definition_versioning(mem_session_maker, monkeypatch):
    monkeypatch.setattr(jobs2_db, "async_session_maker", mem_session_maker)

    job_id, job_v = await jobs2_db.upsert_job_definition(source="user_defined", created_by="user1")

    exp_id, v1 = await jobs2_db.upsert_experiment_definition(
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by="user1",
        experiment_definition={"cron": "0 * * * *"},
    )
    assert v1 == 1

    _, v2 = await jobs2_db.upsert_experiment_definition(
        id=exp_id,
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by="user1",
        experiment_definition={"cron": "30 * * * *"},
    )
    assert v2 == 2

    latest = await jobs2_db.get_experiment_definition(exp_id)
    assert latest is not None
    assert latest.version == 2
    assert latest.experiment_definition == {"cron": "30 * * * *"}


@pytest.mark.asyncio
async def test_jobs2_experiment_definition_soft_delete(mem_session_maker, monkeypatch):
    monkeypatch.setattr(jobs2_db, "async_session_maker", mem_session_maker)

    job_id, job_v = await jobs2_db.upsert_job_definition(source="user_defined", created_by="user1")
    exp_id, _ = await jobs2_db.upsert_experiment_definition(
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by="user1",
    )

    await jobs2_db.soft_delete_experiment_definition(exp_id)

    assert await jobs2_db.get_experiment_definition(exp_id) is None
    experiments = list(await jobs2_db.list_experiment_definitions())
    assert all(e.id != exp_id for e in experiments)


# ---------------------------------------------------------------------------
# JobExecution
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_jobs2_job_execution_latest_attempt(mem_session_maker, monkeypatch):
    monkeypatch.setattr(jobs2_db, "async_session_maker", mem_session_maker)

    job_id, job_v = await jobs2_db.upsert_job_definition(source="user_defined", created_by="user1")

    exec_id, a1 = await jobs2_db.upsert_job_execution(
        job_definition_id=job_id,
        job_definition_version=job_v,
        created_by="user1",
        status="submitted",
    )
    assert a1 == 1

    _, a2 = await jobs2_db.upsert_job_execution(
        id=exec_id,
        job_definition_id=job_id,
        job_definition_version=job_v,
        created_by="user1",
        status="submitted",
    )
    assert a2 == 2

    # Latest attempt returned by default
    latest = await jobs2_db.get_job_execution(exec_id)
    assert latest is not None
    assert latest.attempt_count == 2

    # Explicit attempt lookup works
    first = await jobs2_db.get_job_execution(exec_id, attempt_count=1)
    assert first is not None
    assert first.attempt_count == 1


@pytest.mark.asyncio
async def test_jobs2_update_job_execution_runtime(mem_session_maker, monkeypatch):
    monkeypatch.setattr(jobs2_db, "async_session_maker", mem_session_maker)

    job_id, job_v = await jobs2_db.upsert_job_definition(source="user_defined", created_by="user1")
    exec_id, attempt = await jobs2_db.upsert_job_execution(
        job_definition_id=job_id,
        job_definition_version=job_v,
        created_by="user1",
        status="submitted",
    )

    await jobs2_db.update_job_execution_runtime(
        exec_id, attempt, status="success", cascade_job_id="job-abc", outputs={"url": "s3://bucket/out"}
    )

    execution = await jobs2_db.get_job_execution(exec_id, attempt_count=attempt)
    assert execution is not None
    assert execution.status == "success"
    assert execution.cascade_job_id == "job-abc"
    assert execution.outputs == {"url": "s3://bucket/out"}


@pytest.mark.asyncio
async def test_jobs2_job_execution_soft_delete(mem_session_maker, monkeypatch):
    monkeypatch.setattr(jobs2_db, "async_session_maker", mem_session_maker)

    job_id, job_v = await jobs2_db.upsert_job_definition(source="user_defined", created_by="user1")
    exec_id, _ = await jobs2_db.upsert_job_execution(
        job_definition_id=job_id,
        job_definition_version=job_v,
        created_by="user1",
        status="submitted",
    )

    await jobs2_db.soft_delete_job_execution(exec_id)

    assert await jobs2_db.get_job_execution(exec_id) is None
    executions = list(await jobs2_db.list_job_executions())
    assert all(e.id != exec_id for e in executions)


@pytest.mark.asyncio
async def test_jobs2_list_job_executions_latest_only(mem_session_maker, monkeypatch):
    monkeypatch.setattr(jobs2_db, "async_session_maker", mem_session_maker)

    job_id, job_v = await jobs2_db.upsert_job_definition(source="user_defined", created_by="user1")
    exec_id, _ = await jobs2_db.upsert_job_execution(
        job_definition_id=job_id, job_definition_version=job_v, created_by="user1", status="submitted"
    )

    executions = list(await jobs2_db.list_job_executions())
    matching = [e for e in executions if e.id == exec_id]
    assert len(matching) == 1
    assert matching[0].attempt_count == 1


# ---------------------------------------------------------------------------
# GlobalDefaults
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_jobs2_global_defaults(mem_session_maker, monkeypatch):
    monkeypatch.setattr(jobs2_db, "async_session_maker", mem_session_maker)

    # No defaults yet
    assert await jobs2_db.get_global_defaults() is None

    defaults_id = await jobs2_db.insert_global_defaults(
        created_by="admin",
        option_specs={"outputType": "zarr"},
        value_specs={"modelCheckpoint": "aifs-1.0"},
    )

    defaults = await jobs2_db.get_global_defaults()
    assert defaults is not None
    assert defaults.id == defaults_id
    assert defaults.option_specs == {"outputType": "zarr"}
    assert defaults.value_specs == {"modelCheckpoint": "aifs-1.0"}


# ---------------------------------------------------------------------------
# ExperimentNext
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_jobs2_experiment_next_upsert(mem_session_maker, monkeypatch):
    monkeypatch.setattr(jobs2_db, "async_session_maker", mem_session_maker)

    job_id, job_v = await jobs2_db.upsert_job_definition(source="user_defined", created_by="user1")
    exp_id, _ = await jobs2_db.upsert_experiment_definition(
        job_definition_id=job_id,
        job_definition_version=job_v,
        experiment_type="cron_schedule",
        created_by="user1",
    )

    t1 = dt.datetime(2026, 1, 1, 12, 0)
    await jobs2_db.upsert_experiment_next(experiment_id=exp_id, scheduled_at=t1)

    result = await jobs2_db.get_experiment_next(exp_id)
    assert result is not None
    assert result.scheduled_at == t1

    # Upsert again should update the scheduled_at
    t2 = dt.datetime(2026, 1, 2, 12, 0)
    await jobs2_db.upsert_experiment_next(experiment_id=exp_id, scheduled_at=t2)

    result2 = await jobs2_db.get_experiment_next(exp_id)
    assert result2 is not None
    assert result2.scheduled_at == t2

    # Only one row per experiment_id
    assert result2.id == result.id


# ---------------------------------------------------------------------------
# id-provided guard
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_jobs2_upsert_job_definition_unknown_id_raises(mem_session_maker, monkeypatch):
    monkeypatch.setattr(jobs2_db, "async_session_maker", mem_session_maker)

    with pytest.raises(KeyError, match="No JobDefinition"):
        await jobs2_db.upsert_job_definition(
            id="nonexistent-id", source="user_defined", created_by="user1"
        )


@pytest.mark.asyncio
async def test_jobs2_upsert_experiment_definition_unknown_id_raises(mem_session_maker, monkeypatch):
    monkeypatch.setattr(jobs2_db, "async_session_maker", mem_session_maker)

    job_id, job_v = await jobs2_db.upsert_job_definition(source="user_defined", created_by="user1")

    with pytest.raises(KeyError, match="No ExperimentDefinition"):
        await jobs2_db.upsert_experiment_definition(
            id="nonexistent-id",
            job_definition_id=job_id,
            job_definition_version=job_v,
            experiment_type="cron_schedule",
            created_by="user1",
        )


@pytest.mark.asyncio
async def test_jobs2_upsert_job_execution_unknown_id_raises(mem_session_maker, monkeypatch):
    monkeypatch.setattr(jobs2_db, "async_session_maker", mem_session_maker)

    job_id, job_v = await jobs2_db.upsert_job_definition(source="user_defined", created_by="user1")

    with pytest.raises(KeyError, match="No JobExecution"):
        await jobs2_db.upsert_job_execution(
            id="nonexistent-id",
            job_definition_id=job_id,
            job_definition_version=job_v,
            created_by="user1",
            status="submitted",
        )

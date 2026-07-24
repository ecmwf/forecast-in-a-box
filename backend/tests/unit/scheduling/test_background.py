# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Focused scheduler tests for the synchronous jobs-db cutover."""

import datetime as dt
from unittest.mock import patch

from cascade.low.func import Either

import forecastbox.domain.blueprint.db as blueprint_db
import forecastbox.domain.experiment.db as experiment_db
import forecastbox.domain.experiment.scheduling.db as scheduling_db
from forecastbox.domain.blueprint.types import BlueprintId
from forecastbox.domain.experiment.scheduling.background import SchedulerThread
from forecastbox.domain.experiment.scheduling.job_utils import RunnableExperiment
from forecastbox.domain.experiment.types import ExperimentDefinitionId
from forecastbox.domain.run.db import CompilerRuntimeContext
from forecastbox.domain.run.service import ExecuteResult
from forecastbox.domain.run.types import RunId


def _make_blueprint() -> blueprint_db.BlueprintRecord:
    return blueprint_db.BlueprintRecord(
        blueprint_id="bp-1",
        version=1,
        created_by="user-1",
        created_at=dt.datetime(2026, 5, 12, tzinfo=dt.UTC),
        source="user_defined",
        parent_id=None,
        display_name="Blueprint",
        display_description=None,
        tags=None,
        builder={"blocks": [], "environment": None, "local_glyphs": {}},
        fiabcore_major=1,
        is_deleted=False,
    )


def test_scheduler_thread_runs_without_stored_loop() -> None:
    thread = SchedulerThread()
    assert not hasattr(thread, "_loop")
    assert not hasattr(thread, "_run_async")
    now = dt.datetime(2026, 5, 12, 1, 0, tzinfo=dt.UTC)

    exp_next = scheduling_db.ExperimentNextRecord(
        experiment_next_id="next-1",
        experiment_id="exp-1",
        scheduled_at=now - dt.timedelta(minutes=30),
        updated_at=now,
    )
    exp_def = experiment_db.ExperimentDefinitionRecord(
        experiment_definition_id="exp-1",
        version=1,
        created_by="user-1",
        created_at=dt.datetime(2026, 5, 12, tzinfo=dt.UTC),
        display_name=None,
        display_description=None,
        tags=None,
        blueprint_id="bp-1",
        blueprint_version=1,
        experiment_type="cron_schedule",
        experiment_definition={"enabled": True, "cron_expr": "0 * * * *", "max_acceptable_delay_hours": 24},
        is_deleted=False,
    )
    runnable = RunnableExperiment(
        blueprint=_make_blueprint(),
        created_by="user-1",
        next_run_at=None,
        scheduled_at=now - dt.timedelta(minutes=30),
        experiment_id=ExperimentDefinitionId("exp-1"),
        blueprint_id=BlueprintId("bp-1"),
        blueprint_version=1,
        max_acceptable_delay_hours=24,
        compiler_runtime_context=CompilerRuntimeContext(),
    )

    def fake_jobs_db_result(task_name: str, task: object) -> object:
        del task
        mapping = {
            "scheduler.get-schedulable-experiments": [(exp_next, exp_def)],
            "scheduler.experiment-to-runnable": Either.ok(runnable),
            "scheduler.delete-experiment-next": None,
            "scheduler.next-schedulable-experiment": None,
        }
        return mapping[task_name]

    with (
        patch.object(thread, "mark_alive", return_value=now),
        patch("forecastbox.domain.experiment.scheduling.background._jobs_db_result", side_effect=fake_jobs_db_result),
        patch(
            "forecastbox.domain.experiment.scheduling.background.submit_run_sync",
            return_value=Either.ok(ExecuteResult(run_id=RunId("run-1"), attempt_count=1)),
        ) as mock_submit_run_sync,
    ):
        sleep_duration = thread._try_schedule()

    assert sleep_duration >= 0
    mock_submit_run_sync.assert_called_once()

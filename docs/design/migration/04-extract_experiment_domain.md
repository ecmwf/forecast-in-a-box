# 04 - extract experiment domain

Likely files and directories to read and modify first:

- `backend/src/forecastbox/db/jobs.py`
- `backend/src/forecastbox/api/routers/schedule.py`
- `backend/src/forecastbox/api/scheduling/job_utils.py`
- `backend/src/forecastbox/api/scheduling/dt_utils.py`
- `backend/src/forecastbox/api/scheduling/scheduler_thread.py`
- `backend/src/forecastbox/api/types/scheduling.py`
- `backend/src/forecastbox/schemas/jobs.py` or new `schemata/jobs.py`
- `backend/tests/unit/test_jobs.py`
- `backend/tests/integration/test_schedule.py`

## Objective

Create `forecastbox.domain.experiment` as the canonical home for `ExperimentDefinition`, scheduler state, and experiment operations, again enforcing authorization immediately.

## Required outcome

- `domain.experiment.db` owns experiment-definition persistence.
- `domain.experiment.scheduling` owns `ExperimentNext` and scheduler-support logic.
- `domain.experiment.service` owns schedule/experiment operations currently embedded in route code.
- authorization is enforced in the new experiment-layer APIs rather than postponed.

## Concrete changes

1. Create:

- `forecastbox/domain/experiment/__init__.py`
- `forecastbox/domain/experiment/db.py`
- `forecastbox/domain/experiment/service.py`
- `forecastbox/domain/experiment/exceptions.py`
- `forecastbox/domain/experiment/scheduling/`

2. Move experiment-definition persistence out of `db/jobs.py`.

This includes create/update/get/list/delete and version handling.

3. Move `ExperimentNext` and scheduler-support persistence out of `db/jobs.py`.

This includes:

- next-run upsert/get/delete,
- schedulable experiment selection,
- scheduler time lookup helpers.

4. Move schedule logic out of `api/scheduling/*`.

The scheduler code should become experiment-domain code rather than route-adjacent code.

5. Add authorization checks in the new experiment layer.

Treat gaps in current schedule/experiment permissions as bugs and fix them now.

## Behavior constraints

- Do not rename `/schedule/*` yet; route renaming happens later.
- Preserve scheduler behavior, locking, and thread lifecycle exactly.

## Validation

- Run `cd backend && just val`.

## Handoff notes for the next step

This step is successful when execution logic and later route work can depend on `domain.experiment` instead of `db.jobs` and `api.scheduling`.

# 05 - extract execution domain

Likely files and directories to read and modify first:

- `backend/src/forecastbox/api/execution.py`
- `backend/src/forecastbox/api/routers/job.py`
- `backend/src/forecastbox/db/jobs.py`
- `backend/src/forecastbox/api/utils.py`
- `backend/src/forecastbox/schemas/jobs.py` or new `schemata/jobs.py`
- `backend/tests/unit/test_jobs.py`
- `backend/tests/integration/utils.py`
- any enabled execution integration coverage

## Objective

Create `forecastbox.domain.execution` as the canonical home for `JobExecution` persistence and execution logic, including status polling, restart, output lookup, and any ownership checks around those operations.

## Required outcome

- `domain.execution.db` owns execution persistence.
- `domain.execution.service` owns create/restart/poll/get/list/delete logic.
- authorization is enforced in the new execution layer instead of being left scattered in routes.
- `api/execution.py` is no longer the real owner of execution behavior.

## Concrete changes

1. Create:

- `forecastbox/domain/execution/__init__.py`
- `forecastbox/domain/execution/db.py`
- `forecastbox/domain/execution/service.py`
- `forecastbox/domain/execution/exceptions.py`

2. Move execution persistence out of `db/jobs.py`.

This includes:

- execution creation,
- latest-attempt lookup,
- runtime-state updates,
- list/count helpers,
- delete/tombstone handling,
- experiment-linked execution listing.

3. Move higher-level execution logic out of `api/execution.py`.

This includes:

- compile-and-submit flow,
- restart flow,
- status polling,
- linked-definition lookup,
- output availability/content lookups,
- logs packaging if it remains execution-specific.

4. Introduce authorization checks immediately.

Treat missing ownership checks on execution reads/writes/restarts/deletes as bugs and fix them now.

## Behavior constraints

- Do not rename `/job/*` yet; route renaming happens later.
- Preserve current runtime behavior around scheduler, gateway, and artifact interactions.
- Assume `models` and `products` are already gone from step 01 and do not recreate those dependencies.

## Validation

- Run `cd backend && just val`.

## Handoff notes for the next step

This step is successful when canonical route work can call `domain.execution` directly and `api/execution.py` is no longer architecturally central.

# 06 - create canonical entity routes

Likely files and directories to read and modify first:

- `backend/src/forecastbox/entrypoint.py`
- `backend/src/forecastbox/routes/`
- `backend/src/forecastbox/api/routers/fable.py`
- `backend/src/forecastbox/api/routers/job.py`
- `backend/src/forecastbox/api/routers/schedule.py`
- `backend/src/forecastbox/api/types/`
- `backend/src/forecastbox/domain/definition/`
- `backend/src/forecastbox/domain/experiment/`
- `backend/src/forecastbox/domain/execution/`
- `backend/tests/integration/test_schedule.py`
- execution-related integration tests and helpers

## Objective

Replace the legacy entity route families with the canonical ones described by the architecture:

- `/definition/*`
- `/definition/building/*`
- `/execution/*`
- `/experiment/*`
- `/experiment/runs/*`
- `/experiment/operational/*`

This is the step where entity-route renaming is expected to happen. There is no requirement to preserve `/fable/*`, `/job/*`, or `/schedule/*`.

## Required outcome

- canonical entity route modules exist under `forecastbox.routes`,
- route-local contracts live with those route modules,
- legacy entity route modules are removed from runtime use,
- tests are updated to the new route names and request shapes in the same step.

## Canonical route surface

### Definition routes

- `POST /definition/create`
- `GET /definition/get`
- `GET /definition/list`
- `POST /definition/update`
- `POST /definition/delete`

### Definition-building routes

- `GET /definition/building/catalogue`
- `PUT /definition/building/expand`
- `PUT /definition/building/compile`

### Execution routes

- `POST /execution/create`
- `GET /execution/list`
- `GET /execution/get`
- `POST /execution/restart`
- `GET /execution/outputAvailability`
- `GET /execution/outputContent`
- `GET /execution/definition`
- `GET /execution/logs`
- `POST /execution/delete`

### Experiment routes

- `POST` or `PUT /experiment/create`
- `GET /experiment/get`
- `GET /experiment/list`
- `POST /experiment/update`
- `POST /experiment/delete`
- `GET /experiment/runs/list`
- `GET /experiment/runs/next`
- `GET /experiment/operational/scheduler/current_time`
- `POST /experiment/operational/scheduler/restart`

## Contract rules

- No new path parameters for canonical entity routes.
- Requests and responses should use explicit route-local identifier models where appropriate.
- Route-local models should not be reused as internal domain types.

## Removal work required in this step

- remove `/fable/*` from the active router set,
- remove `/job/*` from the active router set,
- remove `/schedule/*` from the active router set,
- update tests accordingly.

## Validation

- Update integration tests to the canonical endpoints.
- Run `cd backend && just val`.

## Handoff notes for the next step

This step is successful when the backend exposes only the canonical entity routes and all entity-route tests have been updated to match.

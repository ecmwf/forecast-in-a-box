# Goal
Record the current frontend schedule situation and define the future migration work needed for schedule endpoints, without assuming that a schedule UI already exists.

## Current finding
No current frontend schedule API consumers were found.

Relevant searches:
- `rg "API_ENDPOINTS\\.schedule|/api/v1/schedule/" frontend/src frontend/tests`
- `rg "schedule" frontend/src frontend/tests`

Observed matches were only generic status labels or copy such as "scheduler" and "scheduled", not actual schedule API wrappers or hooks.

## Available backend v2 schedule routes
- `GET /api/v1/schedule/list_v2`
- `PUT /api/v1/schedule/create_v2`
- `GET /api/v1/schedule/get_v2`
- `POST /api/v1/schedule/update_v2`
- `GET /api/v1/schedule/next_run_v2`
- `GET /api/v1/schedule/runs_v2`

## Mapping to the v1 model
- `/api/v1/schedule/ -> /api/v1/schedule/list_v2`
- `/api/v1/schedule/create -> /api/v1/schedule/create_v2`
- `/api/v1/schedule/{schedule_id} [GET] -> /api/v1/schedule/get_v2`
- `/api/v1/schedule/{schedule_id} [POST] -> /api/v1/schedule/update_v2`
- `/api/v1/schedule/{schedule_id}/next_run -> /api/v1/schedule/next_run_v2`
- `/api/v1/schedule/{schedule_id}/runs -> /api/v1/schedule/runs_v2`

## If a schedule frontend is introduced later
Create the following in order:
1. Endpoint constants in `frontend/src/api/endpoints.ts`
2. TS schedule contract types under `frontend/src/api/types/`
3. Endpoint wrappers under `frontend/src/api/endpoints/`
4. Query/mutation hooks under `frontend/src/api/hooks/`
5. MSW handlers under `frontend/mocks/handlers/`
6. Unit/integration tests covering list/create/get/update/next-run/runs

## Important contract differences to account for later
- v2 schedule create/update reference `job_definition_id` and optional `job_definition_version`; they do not embed `exec_spec`.
- v2 identifiers are `experiment_id`, not `schedule_id`.
- v2 list and runs responses are arrays, not dictionaries keyed by id.
- v2 get/update/next-run/runs use query parameters rather than path-shaped `/{schedule_id}` routes.
- There is no v2 equivalent today for:
  - `/api/v1/schedule/run/{schedule_run_id}`
  - `/api/v1/schedule/restart`

## Validation
- Re-run the searches above before starting any schedule frontend work.
- If schedule API usage appears later, update this file and `10-migrationProgress.md` before implementation so the scope is no longer a hidden assumption.

## Non-goal
Do not create a new schedule frontend surface as part of this migration unless a separate product requirement asks for it.


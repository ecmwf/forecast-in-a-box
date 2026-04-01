# Expected frontend changes from the backend migration

This document is for the later frontend migration effort. It describes the backend contract the frontend should expect **after** the backend migration lands.

Important expectation: the backend migration does **not** preserve frontend compatibility step by step. The frontend is expected to be broken during the backend migration until these changes are carried through. Backend agents do not need to maintain the old frontend route surface.

## Status

This document has been updated to reflect the **actual** changes made in the `bigmig/06` branch. Where the original spec differed from the implemented result, the implemented result takes precedence.

## Main theme

The backend surface is now organized around:

- `/api/v1/job_definition/*` — persisted job definitions (formerly `/fable/*`)
- `/api/v1/job_execution/*` — job executions (formerly `/job/*`)
- `/api/v1/experiment/*` — cron-schedule experiments and runs (formerly `/schedule/*`)
- `/api/v1/plugin/*` — plugin management (URL unchanged)
- `/api/v1/artifacts/*` — artifact management (URL unchanged)
- `/api/v1/admin/*` — admin (URL unchanged)
- `/api/v1/gateway/*` — gateway lifecycle (URL unchanged)
- `/api/v1/status` — system health (URL unchanged)

The frontend should treat entity routes as a hard rename plus contract cleanup, not as a staged aliasing period.

Note: the legacy routers `/fable/*`, `/job/*`, `/schedule/*` are still mounted in the backend for the duration of the frontend migration, but will be removed once the frontend has migrated.

## Actual endpoint mapping

All canonical entity routes are prefixed with `/api/v1`. The table omits that prefix for brevity.

### Job definition (was `/fable/*`)

| Old endpoint | New endpoint | Notes |
| --- | --- | --- |
| `GET /fable/catalogue` | `GET /job_definition/catalogue` | Moved directly under job_definition — no `/building/` sub-path. |
| `PUT /fable/expand` | `PUT /job_definition/expand` | Moved directly under job_definition. |
| `PUT /fable/compile` | **deleted** | Compile endpoint removed; execution handles the compile step internally. |
| `POST /fable/upsert` (new id) | `POST /job_definition/create` | Creates a new definition. Returns `{job_definition_id, version}`. |
| `POST /fable/upsert` (existing id) | `POST /job_definition/update` | Updates existing definition. Body must include `job_definition_id` and current `version`. |
| `GET /fable/retrieve` | `GET /job_definition/get` | Query params: `job_definition_id` (required), `version` (optional, defaults to latest). |
| _(none)_ | `GET /job_definition/list` | New paginated listing. Query params: `page`, `page_size`. |
| _(none)_ | `POST /job_definition/delete` | Soft-delete. Body must include `job_definition_id` and current `version`. |

### Job execution (was `/job/*`)

| Old endpoint | New endpoint | Notes |
| --- | --- | --- |
| `POST /job/execute` | `POST /job_execution/create` | Body: `{job_definition_id, job_definition_version?}`. Returns `{execution_id, attempt_count}`. |
| `GET /job/status` | `GET /job_execution/list` | Paginated. Query params: `page`, `page_size`. |
| `GET /job/{id}/status` | `GET /job_execution/get` | Query params: `execution_id`, `attempt_count?`. |
| `POST /job/{id}/restart` | `POST /job_execution/restart` | Body: `{execution_id, attempt_count}`. `attempt_count` must match current latest. |
| `GET /job/{id}/outputs` | `GET /job_execution/outputAvailability` | Query params: `execution_id`, `attempt_count?`. |
| `GET /job/{id}/results/{dataset}` | `GET /job_execution/outputContent` | Query params: `execution_id`, `dataset_id`, `attempt_count?`. |
| `GET /job/{id}/specification` | `GET /job_execution/definition` | Query params: `execution_id`, `attempt_count?`. |
| `GET /job/{id}/logs` | `GET /job_execution/logs` | Query params: `execution_id`, `attempt_count?`. |
| `DELETE /job/{id}` | `POST /job_execution/delete` | Body: `{execution_id, attempt_count}`. `attempt_count` must match current latest. |

### Experiment (was `/schedule/*`)

| Old endpoint | New endpoint | Notes |
| --- | --- | --- |
| `GET /schedule/list` | `GET /experiment/list` | Paginated. |
| `PUT /schedule/create` | `PUT /experiment/create` | Method stays `PUT`. Returns `{experiment_id}` only. |
| `GET /schedule/get` | `GET /experiment/get` | Query params: `experiment_id`, `version?`. |
| `POST /schedule/update` | `POST /experiment/update` | Body must include `experiment_id` and current `version`. Returns updated `ExperimentDetail`. |
| `POST /schedule/delete` | `POST /experiment/delete` | Body must include `experiment_id` and current `version`. |
| `GET /schedule/runs` | `GET /experiment/runs/list` | Query params: `experiment_id`, `version?`, plus `page`, `page_size`. |
| `GET /schedule/next_run` | `GET /experiment/runs/next` | Query params: `experiment_id`, `version?`. |
| `GET /schedule/current_time` | `GET /experiment/operational/scheduler/current_time` | |
| `POST /schedule/restart` | `POST /experiment/operational/scheduler/restart` | Admin-only. |

### Plugins (URL unchanged)

The URL path `/plugin/*` is unchanged. The frontend does not need to update plugin endpoint URLs.

### Artifacts (URL unchanged)

The URL path `/artifacts/*` is unchanged. The frontend does not need to update artifact endpoint URLs.

## Contract changes — details

### 1. Entity IDs are `*_id` named fields, never bare `id`

All response fields and request body fields use explicit names:

- `job_definition_id` (not `id` or `fable_id`)
- `execution_id`
- `experiment_id`

The old `/fable/retrieve` response had `id`; this is now `job_definition_id`.

### 2. No path parameters on entity endpoints

All canonical entity routes use:

- query parameters (`execution_id`, `attempt_count`, `experiment_id`, etc.) for GET lookups,
- JSON request bodies for mutating calls.

Admin endpoints are the exception and still use path parameters (`/admin/users/{user_id}`).

### 3. Version and attempt_count are required on all mutating calls

This is the most important behavioral change. All update and delete operations are **optimistic-concurrency-controlled**: the caller must supply the version (or attempt_count) they last observed, and the backend returns **HTTP 409** if it no longer matches.

| Endpoint | Required field | 409 condition |
| --- | --- | --- |
| `POST /job_definition/update` | `version: int` in body | version ≠ current latest version |
| `POST /job_definition/delete` | `version: int` in body | version ≠ current latest version |
| `POST /experiment/update` | `version: int` in body | version ≠ current version |
| `POST /experiment/delete` | `version: int` in body | version ≠ current version |
| `POST /job_execution/restart` | `attempt_count: int` in body | attempt_count ≠ current latest attempt |
| `POST /job_execution/delete` | `attempt_count: int` in body | attempt_count ≠ current latest attempt |

The frontend must track the version/attempt_count returned by the last successful read or write and pass it back on the next mutating call.

### 4. `POST /experiment/update` returns the full updated entity

The response is a full `ExperimentDetail` object including the new `experiment_version`. The frontend must use this `experiment_version` as the `version` in any subsequent update or delete.

### 5. Pagination on all list endpoints

All list endpoints (`/job_definition/list`, `/job_execution/list`, `/experiment/list`, `/experiment/runs/list`) accept:

- `page` (default: 1, minimum: 1)
- `page_size` (default: 10, minimum: 1)

Passing `page < 1` or `page_size < 1` returns **HTTP 422**. All list responses include `total`, `page`, `page_size`. Execution and experiment lists also include `total_pages`.

### 6. `job_definition/create` and `job_definition/update` response shapes

`POST /job_definition/create` response:
```json
{"job_definition_id": "...", "version": 1}
```

`POST /job_definition/update` response:
```json
{"job_definition_id": "...", "version": 2}
```
where `version` is the newly created version number.

### 7. `job_execution/create` and `job_execution/get` response shapes

`POST /job_execution/create` response:
```json
{"execution_id": "...", "attempt_count": 1}
```

`GET /job_execution/get` response includes: `execution_id`, `attempt_count`, `status`, `created_at`, `updated_at`, `job_definition_id`, `job_definition_version`, `error?`, `progress?`, `cascade_job_id?`.

### 8. `experiment/create` returns only the ID

`PUT /experiment/create` response:
```json
{"experiment_id": "..."}
```

Use `GET /experiment/get` to retrieve the full detail including the initial `experiment_version` (always 1).

## Changes likely to affect frontend tests and fixtures

- Replace all hardcoded `/fable/*`, `/job/*`, and `/schedule/*` URL constants and test fixtures.
- Replace URL builders that assume path-parameter execution lookups — all entity IDs move to query params or request bodies.
- The `id` field in fable save/retrieve responses is now `job_definition_id`.
- The `fable_id` / `definition_id` terminology is fully replaced by `job_definition_id`.
- `attempt_count` is now **required** (not optional) in restart and delete execution requests.
- `version` is now **required** (not optional) in definition update/delete and experiment update/delete requests.
- Capture `experiment_version` from `POST /experiment/update` responses when chaining multiple updates.
- Add `page` / `page_size` query parameters on all list calls; validate that 0 is rejected (422).
- The `/fable/compile` endpoint is gone — remove any frontend code path that calls it.
- Plugin URLs are unchanged (`/plugin/*` not `/plugins/*`).

## Changes unlikely to matter directly to the frontend

- Internal movement from `db/` to `domain/`.
- Movement from `schemas/` to `schemata/`.
- Entrypoint auto-discovery of routes (routes now self-register via `PREFIX` constant).
- Movement of `config`, `rjsf`, `auth`, and `standalone` to new internal package homes.
- Deletion of backend-only `models` and `products` packages.
- The `compile` endpoint removal is fully internal; execution flow compiles inline.

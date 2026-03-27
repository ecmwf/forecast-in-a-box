# Expected frontend changes from the backend migration

This document is for the later frontend migration effort. It describes the backend contract the frontend should expect **after** the backend migration lands.

Important expectation: the backend migration does **not** preserve frontend compatibility step by step. The frontend is expected to be broken during the backend migration until these changes are carried through. Backend agents do not need to maintain the old frontend route surface.

## Main theme

The current frontend-facing backend surface is organized around:

- `/fable/*`
- `/job/*`
- `/schedule/*`
- `/plugin/*`
- `/artifacts/*`

The target backend surface is expected to be organized around:

- `/definition/*`
- `/definition/building/*`
- `/execution/*`
- `/experiment/*`
- `/experiment/runs/*`
- `/experiment/operational/*`
- `/plugins/*`
- `/artifacts/*`

The frontend should treat this as a hard rename plus contract cleanup, not as a staged aliasing period.

## Expected endpoint mapping

| Current endpoint | Target endpoint | Notes |
| --- | --- | --- |
| `GET /fable/catalogue` | `GET /definition/building/catalogue` | Builder support moves under definition-building. |
| `PUT /fable/expand` | `PUT /definition/building/expand` | Same concept, renamed namespace. |
| `PUT /fable/compile` | `PUT /definition/building/compile` | Same concept, renamed namespace. |
| `POST /fable/upsert` | `POST /definition/create` and `POST /definition/update` | Combined create/update flow is expected to split. |
| `GET /fable/retrieve` | `GET /definition/get` | Definition becomes the first-class entity. |
| `POST /job/execute` | `POST /execution/create` | Execution creation route. |
| `GET /job/status` | `GET /execution/list` | Canonical execution listing. |
| `GET /job/{execution_id}/status` | `GET /execution/get` | No canonical path parameter. |
| `POST /job/{execution_id}/restart` | `POST /execution/restart` | Identifier moves out of the path. |
| `GET /job/{execution_id}/outputs` | `GET /execution/outputAvailability` | Explicit output-availability route. |
| `GET /job/{execution_id}/results` | `GET /execution/outputContent` | Explicit output-content route. |
| `GET /job/{execution_id}/specification` | `GET /execution/definition` | Linked definition lookup. |
| `GET /job/{execution_id}/logs` | `GET /execution/logs` | Identifier moves out of the path. |
| `GET /schedule/list` | `GET /experiment/list` | Schedule becomes one experiment type. |
| `PUT /schedule/create` | `POST` or `PUT /experiment/create` | Canonical experiment creation. |
| `GET /schedule/get` | `GET /experiment/get` | Canonical experiment lookup. |
| `POST /schedule/update` | `POST /experiment/update` | Canonical experiment update. |
| `POST /schedule/delete` | `POST /experiment/delete` | Canonical experiment deletion. |
| `GET /schedule/runs` | `GET /experiment/runs/list` | Canonical experiment-run list. |
| `GET /schedule/next_run` | `GET /experiment/runs/next` | Canonical next-run lookup. |
| `GET /schedule/current_time` | `GET /experiment/operational/scheduler/current_time` | Scheduler operational route. |
| `POST /schedule/restart` | `POST /experiment/operational/scheduler/restart` | Scheduler operational route. |
| `GET /plugin/status` | `GET /plugins/status` | Canonical plural namespace. |
| `GET /plugin/details` | `GET /plugins/details` | Canonical plural namespace. |
| `POST /plugin/install` | `POST /plugins/install` | Canonical plural namespace. |
| `POST /plugin/update` | `POST /plugins/update` | Canonical plural namespace. |
| `POST /plugin/uninstall` | `POST /plugins/uninstall` | Canonical plural namespace. |

## Expected contract changes

### 1. Canonical entity routes stop using path parameters

The frontend should stop assuming entity lookups are encoded in path segments like `/job/<id>/status`. Canonical entity routes are expected to use:

- query parameters for GET lookups,
- JSON request bodies for mutating calls,
- explicit identifier request models rather than scattered primitives where practical.

Admin is the current exception and may keep path parameters for now.

### 2. Definition replaces “fable” as the user-facing persisted concept

Frontend code should stop thinking of `/fable/upsert` and `/fable/retrieve` as the primary saved-object API. The target model is:

- builder payloads under `/definition/building/*`,
- persisted definitions under `/definition/*`.

### 3. Experiment replaces schedule as the canonical entity

The frontend should model schedules as one kind of experiment rather than a separate backend concept. That affects:

- route naming,
- page/component naming,
- client helper naming,
- likely some stored state keys.

### 4. Contracts should become more regular

The frontend should expect more consistent handling of:

- entity identifiers,
- version fields,
- audit fields,
- linked foreign keys,
- enum-like values.

### 5. No alias period should be assumed

Frontend migration should plan for a direct cutover to the canonical route surface rather than gradually trying old and new endpoints in parallel.

## Changes likely to affect frontend tests and fixtures

- Replace all hardcoded `/fable/*`, `/job/*`, and `/schedule/*` test fixtures.
- Replace URL builders that assume path-parameter execution lookups.
- Regenerate or rewrite any client helper layer to the canonical route families listed above.

## Changes unlikely to matter directly to the frontend

- internal movement from `db/` to `domain/`,
- movement from `schemas/` to `schemata/`,
- entrypoint router discovery,
- movement of `config`, `rjsf`, `auth`, and `standalone` to new internal package homes,
- deletion of backend-only `models` and `products` packages so long as their externally visible behavior has already been retired or absorbed elsewhere.

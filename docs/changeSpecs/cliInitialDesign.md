# Initial Rust CLI Design for Workflow Submission and Inspection

## Goal

Introduce a first non-interactive CLI for the backend API, focused on:

- inspecting saved workflows,
- submitting runs from existing workflows,
- inspecting runs and their outputs,
- managing cron schedules,
- checking backend/scheduler status.

This CLI is intentionally **not** the workflow-building UX. Anything that requires gradual client-side construction of a workflow should stay out of scope for now and be handled later by a TUI.

## Terms Used in This Spec

The backend currently uses these entity names:

| Backend term | Meaning | CLI term |
| --- | --- | --- |
| `blueprint` | saved workflow definition | **workflow** |
| `run` | one logical execution, with one or more attempts | **run** |
| `attempt_count` | concrete attempt number of a run | **attempt** |
| `experiment` | cron-based schedule for repeated execution | **schedule** |

The CLI should use **workflow** and **schedule** in user-facing commands and help text, but the Rust library should keep the backend field names in its data models where possible (`blueprint_id`, `experiment_id`, etc.) to avoid accidental contract drift.

## Scope

### In scope

1. Read-only inspection of saved workflows already present in the backend.
2. Run submission from an existing workflow ID.
3. Run inspection, restart, deletion, output listing/fetching, log download.
4. Schedule creation, inspection, update, deletion, run listing, next-run lookup.
5. Scheduler operational commands that already exist in the backend.
6. System status inspection.
7. Rust split into one reusable library crate and one CLI binary crate.

### Explicitly out of scope

1. Workflow building or editing UX:
   - `/api/v1/blueprint/catalogue`
   - `/api/v1/blueprint/expand`
   - `/api/v1/blueprint/variables/list`
   - any client-side persisted workflow-drafting state
2. Interactive terminal flows, prompts, wizards, fuzzy selectors.
3. TUI concerns.
4. Artifacts, plugins, gateway SSE logs, admin user management, release management.
5. Browser/OIDC login flows.

## Backend API Surface the CLI Must Cover

All routes are under `/api/v1`. The backend does **not** use path parameters for these entities; all identifiers are query parameters or JSON body fields.

### System status

| Method | Route | Response |
| --- | --- | --- |
| `GET` | `/status` | `{ api, cascade, ecmwf, scheduler, version, plugins }` |

Known response fields:

- `api`: string, usually `"up"`
- `cascade`: `"up"` or `"down"`
- `ecmwf`: `"up"` or `"down"`
- `scheduler`: backend-defined string, commonly `"up"` or `"down"`
- `version`: backend version string
- `plugins`: backend-defined status string

### Workflow inspection

These are backend blueprint routes, but the CLI should expose them as workflow commands.

| Method | Route | Request shape | Response shape |
| --- | --- | --- | --- |
| `GET` | `/blueprint/list` | query: `page`, `page_size` | `{ blueprints, total, page, page_size }` |
| `GET` | `/blueprint/get` | query: `blueprint_id`, optional `version` | `{ blueprint_id, version, builder, display_name, display_description, tags, parent_id }` |

`/blueprint/list` returns the latest non-deleted version of each visible workflow.

### Runs

| Method | Route | Request shape | Response shape |
| --- | --- | --- | --- |
| `POST` | `/run/create` | `{ blueprint_id, blueprint_version? }` | `{ run_id, attempt_count }` |
| `GET` | `/run/list` | query: `page`, `page_size` | `{ runs, total, page, page_size, total_pages }` |
| `GET` | `/run/get` | query: `run_id`, optional `attempt_count` | `RunDetailResponse` |
| `POST` | `/run/restart` | `{ run_id, attempt_count }` | `{ run_id, attempt_count }` |
| `GET` | `/run/outputAvailability` | query: `run_id`, optional `attempt_count` | `list[str]` effectively opaque task IDs |
| `GET` | `/run/outputContent` | query: `run_id`, optional `attempt_count`, `dataset_id` | binary body with content-type from backend |
| `GET` | `/run/logs` | query: `run_id`, optional `attempt_count` | zip file |
| `POST` | `/run/delete` | `{ run_id, attempt_count }` | empty body |

`RunDetailResponse` fields:

| Field | Type |
| --- | --- |
| `run_id` | string |
| `attempt_count` | integer |
| `status` | string |
| `created_at` | string |
| `updated_at` | string |
| `blueprint_id` | string |
| `blueprint_version` | integer |
| `error` | string or null |
| `progress` | string or null |
| `cascade_job_id` | string or null |

Known run status values today:

- `submitted`
- `preparing`
- `running`
- `completed`
- `failed`

Only `completed` and `failed` should be treated as terminal by the CLI.

Important semantics:

1. `GET /run/list` returns only the **latest attempt** of each logical run.
2. `GET /run/get` without `attempt_count` returns the latest attempt.
3. Older attempts remain readable via explicit `attempt_count`.
4. Restart and delete require the caller to send the current latest `attempt_count` as an optimistic-concurrency token.

### Schedules

The backend uses `experiment` for these routes, but the CLI should call them schedules.

| Method | Route | Request shape | Response shape |
| --- | --- | --- | --- |
| `PUT` | `/experiment/create` | `ExperimentCreateRequest` | `{ experiment_id }` |
| `GET` | `/experiment/get` | query: `experiment_id` | `ExperimentDetail` |
| `GET` | `/experiment/list` | query: `page`, `page_size` | `{ experiments, total, page, page_size, total_pages }` |
| `POST` | `/experiment/update` | `ExperimentUpdateRequest` | `ExperimentDetail` |
| `POST` | `/experiment/delete` | `{ experiment_id, version }` | empty body |
| `GET` | `/experiment/runs/list` | query: `experiment_id`, `page`, `page_size` | `{ runs, total, page, page_size, total_pages }` |
| `GET` | `/experiment/runs/next` | query: `experiment_id` | string |
| `GET` | `/experiment/operational/scheduler/current_time` | none | string |
| `POST` | `/experiment/operational/scheduler/restart` | none | empty body |

`ExperimentCreateRequest` fields:

| Field | Type | Notes |
| --- | --- | --- |
| `blueprint_id` | string | required |
| `blueprint_version` | integer or null | optional |
| `cron_expr` | string | required |
| `max_acceptable_delay_hours` | positive integer | default 24 |
| `first_run_override` | datetime or null | optional |
| `display_name` | string or null | optional |
| `display_description` | string or null | optional |
| `tags` | list[string] or null | optional |

`ExperimentDetail` fields:

| Field | Type |
| --- | --- |
| `experiment_id` | string |
| `experiment_version` | integer |
| `blueprint_id` | string |
| `blueprint_version` | integer |
| `cron_expr` | string |
| `max_acceptable_delay_hours` | integer |
| `enabled` | boolean |
| `created_at` | string |
| `created_by` | string or null |
| `display_name` | string or null |
| `display_description` | string or null |
| `tags` | list[string] or null |

`ExperimentUpdateRequest` fields:

| Field | Type | Notes |
| --- | --- | --- |
| `experiment_id` | string | required |
| `version` | integer | required optimistic-concurrency token |
| `cron_expr` | string or null | optional |
| `enabled` | boolean or null | optional |
| `max_acceptable_delay_hours` | positive integer or null | optional |
| `first_run_override` | datetime or null | optional |

Important semantics:

1. These routes currently operate on **cron schedules** only.
2. `GET /experiment/get`, `GET /experiment/runs/list`, and `GET /experiment/runs/next` accept a route-local `version` concept in Python, but the current backend implementation effectively ignores it. The CLI should therefore **not expose a version selector for schedule read commands** yet.
3. Schedule update and delete require the current latest `experiment_version` as an optimistic-concurrency token.
4. `GET /experiment/runs/next` may return a timestamp string **or the literal string** `not scheduled currently`.
5. Schedule update/delete may return `503` with detail like `Scheduler is busy, please retry.`

### Pagination defaults and quirks

Common defaults:

- `page=1`
- `page_size=10`

Observed backend behavior:

1. Invalid `page` or `page_size` values fail validation with `422`.
2. Run list page out of range returns `404`.
3. Schedule list/runs page out of range returns `400`.
4. Empty schedule-runs pages return an empty list with `total=0`, even for page 2.

The CLI should smooth these differences where possible and present clear user messages.

## Proposed User-Facing Command Tree

Assume installed executable name is `fiab`.

```text
fiab
  status
  workflow
    list
    show
  run
    submit
    list
    status
    wait
    restart
    delete
    outputs
      list
      fetch
    logs
      download
  schedule
    list
    show
    create
    update
    delete
    runs
    next
  scheduler
    time
    restart
```

No interactive prompts. Every command must be fully controllable by flags/args.

## Detailed Command Design

### `fiab status`

Purpose: show backend health and version.

Backend route:

- `GET /api/v1/status`

Human output should be a compact key/value block. `--json` should emit the exact deserialized response.

### `fiab workflow list`

Purpose: inspect saved workflow definitions available in the backend.

Backend route:

- `GET /api/v1/blueprint/list`

Arguments:

- `--page <N>` default `1`
- `--page-size <N>` default `10`
- `--all` to auto-paginate until exhausted

Human output columns:

- workflow ID
- version
- display name
- tags
- source
- created by

### `fiab workflow show <workflow-id>`

Purpose: inspect one saved workflow definition.

Backend route:

- `GET /api/v1/blueprint/get`

Arguments:

- positional `workflow-id`
- `--version <N>` optional

Human output:

1. metadata block
2. compact builder summary:
   - number of blocks
   - table of block instance IDs and factory IDs if easy to derive

`--json` should emit the full backend-derived payload including the full `builder`.

### `fiab run submit --workflow-id <ID>`

Purpose: submit an ad-hoc run from an existing saved workflow.

Backend route:

- `POST /api/v1/run/create`

Arguments:

- `--workflow-id <ID>` required
- `--workflow-version <N>` optional
- `--wait` optional convenience behavior
- `--poll-interval <seconds>` default `2` when `--wait` is used

Behavior:

1. Submit the run.
2. Print the returned `run_id` and `attempt_count`.
3. If `--wait` is set, poll `run status` until terminal.

Human output after plain submit should include:

- run ID
- attempt
- initial status note that the run was submitted

### `fiab run list`

Purpose: list latest run attempts.

Backend route:

- `GET /api/v1/run/list`

Arguments:

- `--page <N>`
- `--page-size <N>`
- `--all`

Human output columns:

- run ID
- attempt
- status
- workflow ID
- workflow version
- created at
- updated at
- cascade job ID

### `fiab run status <run-id>`

Purpose: inspect a run attempt.

Backend route:

- `GET /api/v1/run/get`

Arguments:

- positional `run-id`
- `--attempt <N>` optional; omit for latest

Human output fields:

- run ID
- attempt
- status
- created at
- updated at
- workflow ID
- workflow version
- progress
- error
- cascade job ID

### `fiab run wait <run-id>`

Purpose: block until a run reaches a terminal state.

Backend route:

- repeated `GET /api/v1/run/get`

Arguments:

- positional `run-id`
- `--attempt <N>` optional
- `--poll-interval <seconds>` default `2`
- `--timeout <seconds>` optional

Exit semantics:

- exit `0` on `completed`
- non-zero on `failed`, timeout, or transport/auth errors

This command is a CLI convenience wrapper; it does not correspond to a backend route.

### `fiab run restart <run-id>`

Purpose: create the next attempt of an existing run.

Backend route:

- `POST /api/v1/run/restart`

Arguments:

- positional `run-id`
- `--attempt <N>` optional optimistic-concurrency token
- `--wait`
- `--poll-interval <seconds>`

Default behavior should be user-friendly:

1. If `--attempt` is omitted, first call `GET /run/get` for the latest attempt.
2. Use the returned `attempt_count` in the restart request.
3. If the backend still returns `409`, surface that directly.

This hides route awkwardness without changing semantics.

### `fiab run delete <run-id>`

Purpose: delete a run and request deletion of its backend/Cascade outputs.

Backend route:

- `POST /api/v1/run/delete`

Arguments:

- positional `run-id`
- `--attempt <N>` optional optimistic-concurrency token
- `--yes` optional confirmation bypass if a confirmation layer is ever added later

As with restart, the CLI should auto-resolve the latest attempt when `--attempt` is omitted.

There should be **no interactive confirmation** in the initial release.

### `fiab run outputs list <run-id>`

Purpose: list available output dataset/task IDs for a run.

Backend route:

- `GET /api/v1/run/outputAvailability`

Arguments:

- positional `run-id`
- `--attempt <N>` optional

Important note:

The backend returns opaque task IDs. The CLI should display them as-is and should not attempt to infer product names.

### `fiab run outputs fetch <run-id> <dataset-id>`

Purpose: fetch one output dataset.

Backend route:

- `GET /api/v1/run/outputContent`

Arguments:

- positional `run-id`
- positional `dataset-id`
- `--attempt <N>` optional
- `-o, --output <PATH>` optional
- `--stdout` optional

Behavior:

1. Fetch bytes and content-type.
2. If `--output` is set, write bytes to that path.
3. If `--stdout` is set, write raw bytes to stdout and suppress human chatter.
4. If neither is set:
   - print text bodies only when content type is clearly textual,
   - otherwise fail with a message requiring `--output` or `--stdout`.

This avoids dumping arbitrary binary data into an interactive terminal.

### `fiab run logs download <run-id>`

Purpose: download the zip archive returned by the backend.

Backend route:

- `GET /api/v1/run/logs`

Arguments:

- positional `run-id`
- `--attempt <N>` optional
- `-o, --output <PATH>` optional

Default output path when omitted:

`./run-<run_id>-attempt-<attempt>-logs.zip`

If `--attempt` is omitted, the CLI should first resolve the latest attempt so the default filename is deterministic.

### `fiab schedule list`

Purpose: list schedules.

Backend route:

- `GET /api/v1/experiment/list`

Arguments:

- `--page <N>`
- `--page-size <N>`
- `--all`

Human output columns:

- schedule ID
- version
- workflow ID
- workflow version
- cron
- enabled
- created at
- created by
- display name

### `fiab schedule show <schedule-id>`

Purpose: inspect one schedule.

Backend route:

- `GET /api/v1/experiment/get`

Arguments:

- positional `schedule-id`

Do not expose `--version` for this read command until the backend actually honors it.

### `fiab schedule create`

Purpose: create a cron schedule from an existing workflow.

Backend route:

- `PUT /api/v1/experiment/create`

Arguments:

- `--workflow-id <ID>` required
- `--workflow-version <N>` optional
- `--cron <EXPR>` required
- `--max-acceptable-delay-hours <N>` default `24`
- `--first-run-override <RFC3339>` optional
- `--name <TEXT>` optional
- `--description <TEXT>` optional
- `--tag <TEXT>` repeatable

CLI should serialize timestamps in a backend-friendly ISO/RFC3339 form.

### `fiab schedule update <schedule-id>`

Purpose: update mutable schedule fields.

Backend route:

- `POST /api/v1/experiment/update`

Arguments:

- positional `schedule-id`
- `--version <N>` optional optimistic-concurrency token
- `--cron <EXPR>` optional
- `--enable` optional
- `--disable` optional
- `--max-acceptable-delay-hours <N>` optional
- `--first-run-override <RFC3339>` optional

Rules:

1. `--enable` and `--disable` are mutually exclusive.
2. At least one update field must be provided.
3. If `--version` is omitted, first fetch the schedule and use its current `experiment_version`.
4. If the backend returns `503 SchedulerBusy`, surface that clearly and suggest retrying.

Notably absent:

- no update of display name
- no update of description
- no update of tags

Those are not supported by the current backend route and should not be invented in the CLI.

### `fiab schedule delete <schedule-id>`

Purpose: delete a schedule.

Backend route:

- `POST /api/v1/experiment/delete`

Arguments:

- positional `schedule-id`
- `--version <N>` optional optimistic-concurrency token

Default behavior should auto-resolve the latest version if `--version` is omitted.

### `fiab schedule runs <schedule-id>`

Purpose: list runs associated with a schedule.

Backend route:

- `GET /api/v1/experiment/runs/list`

Arguments:

- positional `schedule-id`
- `--page <N>`
- `--page-size <N>`
- `--all`

Human output columns:

- run ID
- attempt
- status
- created at
- updated at
- experiment context

### `fiab schedule next <schedule-id>`

Purpose: show the next scheduled execution time.

Backend route:

- `GET /api/v1/experiment/runs/next`

Arguments:

- positional `schedule-id`

Human output should print either:

- the timestamp, or
- `not scheduled currently`

without rewriting the backend sentinel into some other phrase.

### `fiab scheduler time`

Purpose: inspect the scheduler clock used by the backend.

Backend route:

- `GET /api/v1/experiment/operational/scheduler/current_time`

### `fiab scheduler restart`

Purpose: restart the backend scheduler thread.

Backend route:

- `POST /api/v1/experiment/operational/scheduler/restart`

This should be marked as an admin-only command in help text.

## Configuration and Authentication

### Base URL

The CLI should accept a server root URL like:

- `http://localhost:8000`
- `https://fiab.example.org`

The client library should append `/api/v1` internally. Users should not need to include it.

### Config precedence

Recommended precedence:

1. explicit CLI flags
2. environment variables
3. config file
4. built-in defaults

Recommended config file location:

- Linux/macOS: `~/.config/fiab/config.toml`

Suggested config shape:

```toml
[profiles.default]
server_url = "http://localhost:8000"
auth_token = ""
request_timeout_seconds = 30
poll_interval_seconds = 2
```

Global CLI flags:

- `--server <URL>`
- `--profile <NAME>`
- `--json`
- `--timeout <SECONDS>`
- `--verbose`

Suggested environment variables:

- `FIAB_SERVER_URL`
- `FIAB_AUTH_TOKEN`
- `FIAB_PROFILE`

### Authentication model

The backend currently uses **cookie-based JWT auth**, not bearer auth.

The relevant cookie name is:

- `forecastbox_auth`

Therefore the Rust client should authenticate by sending:

```http
Cookie: forecastbox_auth=<token>
```

Using a cookie jar is optional. For this initial CLI, manually setting the `Cookie` header is sufficient and simpler.

Initial CLI auth design:

1. Support anonymous/passthrough deployments with no token.
2. Support authenticated deployments by accepting a pre-obtained token from config/env/flag.
3. Before the first protected call, optionally probe `/api/v1/admin/uiConfig`:
   - if `authType == "anonymous"`, proceed without token,
   - if `authType == "authenticated"` and no token is configured, fail fast with a clear message.
4. Do **not** implement OIDC or browser login in this initial CLI.

This keeps the first implementation focused on workflow operations and avoids coupling the CLI to browser flows.

## Output, Rendering, and Scriptability

The binary crate should own all presentation logic.

### Human-readable default

- tables for lists
- key/value blocks for single resources
- short success lines for mutations

### Machine-readable mode

`--json` should print a stable JSON form of the deserialized library models.

Rules:

1. Do not include ANSI color or extra prose in `--json` mode.
2. For binary download commands, `--json` should print metadata only when the primary output is written to a file; otherwise it should be rejected.
3. Human mode may use friendly labels like `Workflow ID`, but JSON keys should stay close to backend field names.

## Error Handling and Exit Codes

The library should preserve HTTP status and backend `detail` text.

Recommended client error categories:

- transport/connectivity failure
- timeout
- HTTP error with decoded backend detail
- serialization/deserialization failure
- authentication required / missing token
- local config error
- local file I/O error

Recommended CLI exit codes:

| Exit code | Meaning |
| --- | --- |
| `0` | success |
| `1` | generic failure |
| `2` | CLI usage or local config error |
| `3` | authentication missing/forbidden |
| `4` | not found |
| `5` | conflict / stale version / stale attempt |
| `6` | service unavailable / scheduler busy |
| `7` | network or timeout |

Suggested HTTP-to-exit mapping:

- `400`, `422` -> `2`
- `401`, `403` -> `3`
- `404` -> `4`
- `409` -> `5`
- `503` -> `6`

## Rust Workspace and Crate Layout

There is currently no Rust workspace in the repository. Create one dedicated top-level Rust area rather than embedding it into the Python backend package.

Recommended layout:

```text
rust/
  Cargo.toml
  crates/
    fiab-client/
      Cargo.toml
      src/
        lib.rs
        client.rs
        config.rs
        error.rs
        pagination.rs
        polling.rs
        models/
          mod.rs
          status.rs
          workflow.rs
          run.rs
          schedule.rs
        api/
          mod.rs
          status.rs
          workflow.rs
          run.rs
          schedule.rs
    fiab-cli/
      Cargo.toml
      src/
        main.rs
        cli.rs
        config.rs
        render.rs
        commands/
          mod.rs
          status.rs
          workflow.rs
          run.rs
          schedule.rs
          scheduler.rs
```

Future addition:

```text
rust/crates/fiab-tui/
```

### Recommended Rust crates

Recommended, not mandatory:

- `tokio` for async runtime
- `reqwest` for HTTP
- `serde` and `serde_json` for contracts
- `clap` for CLI parsing
- `thiserror` or `miette` for errors
- `bytes` for binary payloads
- `toml` for config parsing
- `directories` or `dirs` for config path resolution
- `comfy-table` or similar for human-readable tables

## Library vs Binary Responsibilities

### `fiab-client` library crate

This crate is the long-lived asset and must be reusable by both CLI and future TUI.

Responsibilities:

1. HTTP transport and route construction.
2. Typed request/response models.
3. Auth injection via cookie header.
4. Pagination helpers.
5. Polling helpers for run waiting.
6. Binary payload handling helpers:
   - output bytes + content type
   - logs zip bytes
7. Error typing.
8. Small convenience workflows that are still UI-agnostic:
   - resolve latest run attempt before restart/delete
   - resolve latest schedule version before update/delete
   - wait for run completion

Non-responsibilities:

- clap parsing
- terminal rendering
- config-file UX
- confirmation/prompt behavior

### `fiab-cli` binary crate

Responsibilities:

1. Command-line parsing.
2. Config loading and merging.
3. Human-readable rendering.
4. File writing for downloads.
5. Exit-code mapping.
6. Converting user-facing CLI terms (`workflow`, `schedule`) into library calls using backend models.

## Library API Shape

The library should expose both a low-level route-mirroring API and a thin convenience layer.

Suggested shape:

```rust
pub struct ClientConfig {
    pub server_url: String,
    pub auth_token: Option<String>,
    pub request_timeout: Duration,
}

pub struct FiabClient { /* ... */ }

impl FiabClient {
    pub fn new(config: ClientConfig) -> Result<Self, ClientError>;

    pub async fn get_status(&self) -> Result<StatusResponse, ClientError>;

    pub async fn list_workflows(&self, page: u32, page_size: u32) -> Result<WorkflowListResponse, ClientError>;
    pub async fn get_workflow(&self, blueprint_id: &str, version: Option<u32>) -> Result<WorkflowDetail, ClientError>;

    pub async fn submit_run(&self, blueprint_id: &str, blueprint_version: Option<u32>) -> Result<RunCreateResponse, ClientError>;
    pub async fn list_runs(&self, page: u32, page_size: u32) -> Result<RunListResponse, ClientError>;
    pub async fn get_run(&self, run_id: &str, attempt_count: Option<u32>) -> Result<RunDetailResponse, ClientError>;
    pub async fn restart_run(&self, run_id: &str, attempt_count: u32) -> Result<RunCreateResponse, ClientError>;
    pub async fn delete_run(&self, run_id: &str, attempt_count: u32) -> Result<(), ClientError>;
    pub async fn list_run_outputs(&self, run_id: &str, attempt_count: Option<u32>) -> Result<Vec<String>, ClientError>;
    pub async fn fetch_run_output(&self, run_id: &str, attempt_count: Option<u32>, dataset_id: &str) -> Result<BinaryPayload, ClientError>;
    pub async fn fetch_run_logs(&self, run_id: &str, attempt_count: Option<u32>) -> Result<BinaryPayload, ClientError>;

    pub async fn create_schedule(&self, request: CreateScheduleRequest) -> Result<CreateScheduleResponse, ClientError>;
    pub async fn list_schedules(&self, page: u32, page_size: u32) -> Result<ScheduleListResponse, ClientError>;
    pub async fn get_schedule(&self, experiment_id: &str) -> Result<ScheduleDetail, ClientError>;
    pub async fn update_schedule(&self, request: UpdateScheduleRequest) -> Result<ScheduleDetail, ClientError>;
    pub async fn delete_schedule(&self, experiment_id: &str, version: u32) -> Result<(), ClientError>;
    pub async fn list_schedule_runs(&self, experiment_id: &str, page: u32, page_size: u32) -> Result<ScheduleRunsResponse, ClientError>;
    pub async fn get_next_schedule_run(&self, experiment_id: &str) -> Result<NextRunResponse, ClientError>;
    pub async fn get_scheduler_time(&self) -> Result<String, ClientError>;
    pub async fn restart_scheduler(&self) -> Result<(), ClientError>;
}
```

Suggested convenience helpers:

```rust
pub async fn restart_run_latest(&self, run_id: &str) -> Result<RunCreateResponse, ClientError>;
pub async fn delete_run_latest(&self, run_id: &str) -> Result<(), ClientError>;
pub async fn update_schedule_latest(&self, request: UpdateScheduleLatestRequest) -> Result<ScheduleDetail, ClientError>;
pub async fn delete_schedule_latest(&self, experiment_id: &str) -> Result<(), ClientError>;
pub async fn wait_for_run(&self, run_id: &str, attempt_count: Option<u32>, interval: Duration, timeout: Option<Duration>) -> Result<RunDetailResponse, ClientError>;
```

## Model Design Notes

### Be tolerant to backend evolution

Where the backend currently uses string enums, the Rust layer should avoid brittle deserialization.

Examples:

- run status
- auth type

Preferred approach:

- keep raw strings in transport structs, or
- use tolerant enums with an unknown fallback preserving the original string.

### `NextRunResponse`

Because `/experiment/runs/next` returns a plain string with a sentinel, model it explicitly:

```rust
pub enum NextRunResponse {
    Scheduled(String),
    NotScheduled,
    Unknown(String),
}
```

The parser should map the exact backend literal `not scheduled currently` to `NotScheduled`.

### Binary payload wrapper

Use a dedicated type for binary endpoints:

```rust
pub struct BinaryPayload {
    pub content_type: Option<String>,
    pub bytes: bytes::Bytes,
}
```

## UX Conventions

1. Prefer explicit nouns over backend jargon in help text.
2. Keep command names stable even if backend route names change later.
3. Allow scripting without text parsing:
   - `--json`
   - deterministic exit codes
   - no prompts
4. Default mutation commands should print the primary identifier that downstream scripts care about.

## Suggested Implementation Order

1. Create Rust workspace and crates.
2. Implement config loading and base HTTP client.
3. Implement status command.
4. Implement workflow list/show.
5. Implement run submit/list/status/wait.
6. Implement run restart/delete/outputs/logs.
7. Implement schedule list/show/create/update/delete/runs/next.
8. Implement scheduler time/restart.
9. Add JSON rendering and human rendering polish.

## Summary of Design Decisions

1. The initial CLI is **workflow/run/schedule centric**, not a full backend admin client.
2. Workflow building stays out of scope; workflow inspection stays in scope.
3. The Rust code is split into:
   - a reusable library (`fiab-client`)
   - a CLI binary (`fiab-cli`)
4. The library owns transport, models, auth, polling, and convenience helpers.
5. The binary owns clap parsing, rendering, and file output.
6. The CLI uses user-facing terms `workflow` and `schedule`, while the library remains close to backend contracts.
7. The initial auth story is cookie-token injection, not browser login.

# Backend migration overview

This folder defines the backend-only migration plan from the current `forecastbox` layout to the target architecture described in `docs/design/architecture.md`.

The target state is a backend organized around `utility/`, `domain/`, `routes/`, `schemata/`, and `entrypoint/`. The plan below is intentionally aggressive about route renaming and internal reorganization, but it must still preserve backend capability at every step. Tests may be updated as part of each step; frontend compatibility does **not** need to be preserved during the migration.

## Non-negotiable migration rules

- Preserve backend capability, not legacy route names. It is acceptable for frontend behavior to break during the migration as long as backend functionality still exists and backend tests can be updated accordingly.
- Do not keep legacy entity routes just for compatibility. When canonical routes land, `/fable/*`, `/job/*`, and `/schedule/*` should be removed and tests updated in the same step.
- An exception is allowed for the admin router: admin endpoints may keep path parameters for now.
- Do not spend effort on backward-compatible database migrations. Existing databases may be deleted and recreated from scratch with the new schemata.
- Remove obsolete prototype persistence early. `GlobalDefaults` is treated as dead prototype code and should be deleted, not migrated.
- Remove `forecastbox.models` and `forecastbox.products` entirely during the migration, including their unit tests.
- Treat missing authorization in entity persistence/domain logic as a bug. Authorization enforcement should start as soon as the relevant domain extraction begins, not as a later cleanup.
- Put HTTP-only concerns in `routes/*`. Route modules own request/response contracts, HTTP validation, and translation from domain errors to HTTP responses.
- Put business logic in `domain/*`. Domain code must not raise `HTTPException` and must not depend on FastAPI request/response classes.
- Put ORM models in `schemata/*`.
- Move `config` to `utility/config.py`, `rjsf` to `utility/rsjf`, `auth` to `entrypoint/auth/`, and `standalone` to `entrypoint/bootstrap/`.
- Every step must finish with backend validation via `cd backend && just val`.

## Planned end state

The intended end state for this migration is:

- `forecastbox.utility` contains domain-independent helpers and the canonical config package.
- `forecastbox.utility.rsjf` is the canonical home of the preserved RJSF support code and tests.
- `forecastbox.domain.definition`, `forecastbox.domain.experiment`, and `forecastbox.domain.execution` own entity persistence, business logic, authorization checks, and internal DTOs.
- `forecastbox.routes` contains the canonical HTTP routers and route-local contracts.
- `forecastbox.schemata` contains the canonical ORM models and table-registration hooks.
- `forecastbox.entrypoint` owns bootstrapping concerns, including auth and standalone/bootstrap support.
- the old `api/`, `db/`, `schemas/`, `models/`, and `products/` layout is removed or reduced to a minimal internal compatibility shell only where absolutely necessary during the sequence.

There are currently no open concerns requiring a `00-concerns.md` file. If a new unresolved issue appears later, create that file again.

## Migration sequence

### 01. Prune obsolete code and migration baggage

Delete dead or disallowed legacy code up front:

- `GlobalDefaults`,
- the old migration helper path,
- `forecastbox.models`,
- `forecastbox.products`,
- their unit tests,
- now-unused imports and wiring that existed only for those modules.

### 02. Reorganize top-level packages

Create `utility`, `domain`, `routes`, `schemata`, and `entrypoint` scaffolding and move:

- `config.py` -> `utility/config.py`
- `rjsf/` -> `utility/rsjf/`
- `auth/` -> `entrypoint/auth/`
- `standalone/` -> `entrypoint/bootstrap/`

### 03. Extract definition domain

Move `JobDefinition` persistence and definition-building logic into `domain.definition`, with authorization enforcement introduced immediately.

### 04. Extract experiment domain

Move `ExperimentDefinition`, `ExperimentNext`, and scheduler logic into `domain.experiment`, with authorization enforcement introduced immediately.

### 05. Extract execution domain

Move `JobExecution` persistence and execution/restart/polling logic into `domain.execution`, enforcing the intended ownership and admin rules from the start.

### 06. Create canonical entity routes

Introduce the canonical route families:

- `/definition/*`
- `/definition/building/*`
- `/execution/*`
- `/experiment/*`
- `/experiment/runs/*`
- `/experiment/operational/*`

Then remove `/fable/*`, `/job/*`, and `/schedule/*` and update tests in the same step.

### 07. Reorganize support routes

Move artifacts/plugins/admin/auth/gateway/status routing into canonical top-level `routes/*` modules. Admin may keep path parameters. Remove the old router/type layout once tests are updated.

### 08. Switch the entrypoint to discovery

Make startup discover canonical `routes/*` and `schemata/*` automatically and remove the remaining manual route/schema wiring.

## Cross-step implementation notes

- When extracting logic from `db/jobs.py`, copy behavior faithfully first, then simplify only after tests are green.
- When extracting from `api/execution.py` or scheduler code, preserve thread/process behavior exactly.
- When introducing new route contracts, do not reuse them internally.
- Test updates are expected as part of the migration. They should mostly be route-name and request-shape updates, not feature removal.
- `db/migrations.py` and similar compatibility code are not part of the target architecture anymore unless a later concern reintroduces them.
- The `rjsf` test suite is preserved, but it should follow the code move to `utility/rsjf`.

## Files in this folder

- `00-overview.md`: this document.
- `01-*.md` to `08-*.md`: step-specific implementation briefs.
- `99-progress.md`: one-line progress tracker for implementation agents.
- `99-expectedFrontendChanges.md`: final backend contract changes the frontend migration must adapt to.

# 08 - switch entrypoint to discovery

Likely files and directories to read and modify first:

- `backend/src/forecastbox/entrypoint.py`
- `backend/src/forecastbox/routes/`
- `backend/src/forecastbox/schemata/`
- `backend/src/forecastbox/entrypoint/`
- `backend/tests/integration/test_db_startup.py`
- `backend/tests/integration/conftest.py`

## Objective

Make the new architecture real at startup time:

- discover canonical `routes/*` modules automatically,
- discover canonical `schemata/*` modules automatically,
- remove the remaining manual route/schema wiring that belongs to the old layout.

## Required outcome

- startup no longer hardcodes the old router list,
- startup no longer depends on the old schema package layout,
- database creation uses the canonical schemata directly,
- the backend still boots cleanly and passes the test suite.

## Concrete changes

1. Add route discovery.

The entrypoint should iterate one-level-deep modules under `forecastbox.routes` and include every module-level `router`.

2. Add schemata discovery.

The entrypoint should iterate one-level-deep modules under `forecastbox.schemata` and run the expected table-registration hook for each module that provides one.

3. Remove the old manual startup wiring.

By the end of this step, the canonical startup path should no longer be:

- a hand-maintained router include list,
- a hand-maintained schema module list,
- a migration call intended for old on-disk databases.

4. Keep non-route entrypoint behavior stable.

Do not regress:

- scheduler startup/shutdown,
- plugin store initialization,
- artifact manager setup,
- auth boot behavior,
- status endpoint behavior,
- SPA/static mounting.

There is no requirement in this step to preserve a `00-concerns.md` file; if no unresolved issues exist, it should remain absent.

## Cleanup expectation

If any temporary internal shims are still present after this step, they should be narrow and obviously transitional. The canonical source of truth must now be `routes`, `domain`, `schemata`, `utility`, and `entrypoint`.

## Validation

- Run `cd backend && just val`.
- Pay particular attention to startup/database creation behavior in `backend/tests/integration/test_db_startup.py`.

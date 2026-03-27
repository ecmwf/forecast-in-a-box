# 01 - prune obsolete code and migration

Likely files and directories to read and modify first:

- `backend/src/forecastbox/schemas/jobs.py`
- `backend/src/forecastbox/db/jobs.py`
- `backend/src/forecastbox/db/migrations.py`
- `backend/src/forecastbox/entrypoint.py`
- `backend/src/forecastbox/models/`
- `backend/src/forecastbox/products/`
- `backend/tests/unit/test_jobs.py`
- `backend/tests/unit/models/`
- `backend/tests/unit/products/`
- `backend/tests/integration/test_db_startup.py`

## Objective

Delete obsolete persistence and startup baggage that should not survive into the target architecture:

- the `GlobalDefaults` prototype entity,
- the old migration path that only exists to preserve previously created SQLite databases,
- the `forecastbox.models` package,
- the `forecastbox.products` package,
- the unit tests that exist only for those deleted packages.

This step should be small, direct, and final. Because fresh database recreation is now assumed, do not replace the deleted migration logic with another backward-compatibility layer.

## Required outcome

- `GlobalDefaults` is removed from the ORM layer.
- `GlobalDefaults` helpers are removed from persistence code.
- `GlobalDefaults` tests are removed or rewritten if they are still indirectly useful.
- `db/migrations.py` is deleted or emptied out of runtime use.
- `forecastbox.models` is deleted.
- `forecastbox.products` is deleted.
- `backend/tests/unit/models/` and `backend/tests/unit/products/` are deleted.
- startup no longer invokes migration compatibility code.

## Concrete changes

1. Remove `GlobalDefaults` from the ORM model set.

Delete:

- the `GlobalDefaults` class from `schemas/jobs.py`,
- any import/export of that class,
- the corresponding helper functions in `db/jobs.py`.

2. Delete the migration compatibility layer.

Delete `db/migrations.py` and remove its use from `entrypoint.py`. There is no need to preserve migration helpers because the new schemata will recreate databases from scratch.

3. Delete `models` and `products`.

Remove the packages and any now-dead wiring that only existed to support them. Because the user has already verified that the removed imports in execution and the model integration test were unnecessary, treat these package deletions as intentional cleanup, not as provisional work.

4. Clean up tests.

At minimum:

- remove the `GlobalDefaults` section from `backend/tests/unit/test_jobs.py`,
- delete `backend/tests/unit/models/`,
- delete `backend/tests/unit/products/`,
- update any startup tests that assumed a migration call was part of boot.

## Behavior constraints

- Do not change any live job-definition, experiment, or execution behavior in this step.
- Do not rename routes in this step.
- Do not move `rjsf` in this step; that belongs to the top-level package reorganization step.

## Validation

- Run `cd backend && just val`.

## Handoff notes for the next step

This step is successful when later agents no longer need to think about preserving `GlobalDefaults` or old on-disk SQLite compatibility.

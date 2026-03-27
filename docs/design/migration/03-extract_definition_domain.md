# 03 - extract definition domain

Likely files and directories to read and modify first:

- `backend/src/forecastbox/db/jobs.py`
- `backend/src/forecastbox/api/fable.py`
- `backend/src/forecastbox/api/routers/fable.py`
- `backend/src/forecastbox/api/types/fable.py`
- `backend/src/forecastbox/api/types/jobs.py`
- `backend/src/forecastbox/schemas/jobs.py` or new `schemata/jobs.py`
- `backend/tests/unit/test_jobs.py`
- `backend/tests/integration/test_schedule.py`

## Objective

Create `forecastbox.domain.definition` as the canonical home for `JobDefinition` persistence and definition-building logic, and start enforcing the intended authorization rules immediately.

## Required outcome

- `domain.definition.db` owns `JobDefinition` persistence.
- `domain.definition.service` owns definition-building and retrieval logic.
- `domain.definition.exceptions` exists and is used instead of HTTP exceptions.
- authorization is enforced in the new definition-layer APIs rather than postponed.

## Authorization requirement

Treat the current lack of authorization as a bug to be fixed now.

The new definition layer should receive normalized actor context, for example:

- actor user identifier,
- is-admin flag.

Mutating operations must not proceed without checking ownership/admin rules. If read paths also currently overexpose data, fix that in the same step rather than carrying the bug forward.

## Concrete changes

1. Create:

- `forecastbox/domain/definition/__init__.py`
- `forecastbox/domain/definition/db.py`
- `forecastbox/domain/definition/service.py`
- `forecastbox/domain/definition/exceptions.py`

2. Move `JobDefinition` persistence out of `db/jobs.py`.

This includes:

- create/upsert,
- get,
- list,
- delete/tombstone handling,
- version handling,
- authorization enforcement.

3. Move builder-related logic out of `api.fable`.

The new service layer should own:

- saving builder content as a definition,
- reading a definition back into builder form,
- validating/expanding builder content,
- compiling a definition-ready builder payload.

4. Remove HTTP semantics from the moved logic.

No `HTTPException` should survive in the new domain code.

## Behavior constraints

- Do not rename `/fable/*` yet; route renaming happens later.
- Preserve definition capability; tests may be updated only where the new authorization behavior intentionally closes prior gaps.

## Validation

- Run `cd backend && just val`.

## Handoff notes for the next step

This step is successful when later route work can depend on `domain.definition` directly and no longer needs `db.jobs` or `api.fable` as the real source of behavior.

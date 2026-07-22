# Backend concurrency rework: Phase 0 implementation plan

## Purpose and scope

Implement only the preparatory work for the backend concurrency rework:

1. Split the existing concurrency utility helpers into focused modules.
2. Isolate administrative users-database synchronization from jobs-database
   synchronization.

Do not add the execution manager, dispatcher, pools, configuration, event
contracts, or any later migration-phase behavior. Preserve all existing runtime
behavior, including the behavior of `delayed_thread`.

For additional background only, see:

- `backend-concurrencyRework-design.md`
- `backend-concurrencyRework-migration.md`

This plan is self-contained; reading those documents is not required to
implement Phase 0.

## Current state

`forecastbox.utility.concurrent` currently contains four unrelated concerns:

- `timed_acquire`
- `delayed_thread`
- `NoFreePortsException` and `FreePortsManager`
- `shutdown_correctly` and `shutdown_popen`

Production code and one unit test import these symbols directly from that
module.

`forecastbox.domain.auth.db` implements the administrative user helpers used
by `routes/admin.py`. It currently imports the generic async `dbRetry` from
`forecastbox.utility.db`, thereby sharing its asyncio lock with jobs database
operations. FastAPI Users owns separate direct session paths that already
bypass this lock. That existing behavior must remain unchanged in this phase.

## Implementation steps

### 1. Create focused concurrency utility modules

Create this package structure:

```text
backend/src/forecastbox/utility/concurrency/
    __init__.py
    ports.py
    shutdown.py
    synchronization.py
```

Keep `__init__.py` intentionally empty. It must not re-export symbols.

Move symbols without changing their implementation or public behavior:

| Module | Symbols |
| --- | --- |
| `ports.py` | `NoFreePortsException`, `FreePortsManager` |
| `shutdown.py` | `shutdown_correctly`, `shutdown_popen` |
| `synchronization.py` | `timed_acquire`, `delayed_thread` |

Update `delayed_thread`'s docstring to state that it is temporary and is
expected to be replaced by `submit_after` in a later concurrency-rework phase.
Keep its existing behavior: after the dependency future completes with an
exception, it logs a warning and still invokes the supplied function.

### 2. Update every import and delete the old module atomically

Rewrite imports to point to the module defining each symbol:

| New import module | Files |
| --- | --- |
| `utility.concurrency.synchronization` | `domain/artifact/manager.py`, `domain/experiment/service.py`, `domain/experiment/scheduling/background.py`, `domain/plugin/detail.py`, `domain/plugin/manager.py`, `domain/plugin/store.py` |
| `utility.concurrency.ports` | `domain/lens/manager.py`, `routes/lens.py`, `tests/unit/domain/lens/test_lens_manager.py` |
| `utility.concurrency.shutdown` | `entrypoint/bootstrap/procs.py`, `domain/lens/manager.py` |

Delete `backend/src/forecastbox/utility/concurrent.py` in the same change.
Do not leave a compatibility re-export module. The move is complete only when
repository searches find no imports or references to
`forecastbox.utility.concurrent`.

### 3. Isolate administrative users-database retry and locking

Modify `backend/src/forecastbox/domain/auth/db.py`:

1. Add this comment at the top of the module:

   ```python
   # TODO investigate the lock bypass -- not all db access locks, is that a bug or a feature?
   ```

2. Remove the `forecastbox.utility.db.dbRetry` import.
3. Copy the current async retry behavior into this module:
   - a module-local `asyncio.Lock` named `db_lock`;
   - a local async retry helper named `db_retry`;
   - three retries after the initial attempt;
   - lock acquisition around each complete attempted operation;
   - retry only `sqlalchemy.exc.OperationalError`;
   - a 0.1-second async delay between failed attempts.
4. Update all administrative user helpers to call local `db_retry`:
   - `list_users`
   - `get_user_by_id`
   - `delete_user_by_id`
   - `update_user_by_id`
   - `patch_user_by_id`
5. Update the module documentation so it describes a users-database-local lock
   and retry helper rather than a shared utility lock.

Do not change the functions' signatures, query logic, session maker,
transaction boundaries, response behavior, or error behavior.

Do not modify `domain/auth/users.py`, FastAPI Users configuration, or
framework-owned user-session handling. Those paths continue to use the
existing async SQLAlchemy setup and may bypass the administrative helper lock.

### 4. Clarify the remaining utility database scope

Update `backend/src/forecastbox/utility/db.py` documentation/comments to state
that its current async lock and helpers now serve jobs persistence only.

Keep its public API and all current jobs-database callers unchanged. The
synchronous jobs engine, jobs database pool, and broader database API changes
belong to Phase 2, not this work.

## Validation

1. Run the targeted lens-manager unit test after its import move.
2. Add narrowly scoped tests for the local users retry/lock behavior if the
   existing test fixtures permit that without new test infrastructure.
3. Run the relevant backend unit tests and static type check.
4. Search the repository to confirm:
   - no `forecastbox.utility.concurrent` import or reference remains;
   - `domain/auth/db.py` no longer imports `utility.db`;
   - jobs database helpers remain the only callers of `utility.db`.

## Completion criteria

- The old `utility/concurrent.py` file is absent.
- Every former consumer imports from the focused concurrency module that owns
  its symbol.
- `utility/concurrency/__init__.py` does not re-export anything.
- `delayed_thread` still invokes its callable after a failed dependency future.
- Administrative user operations use only the local `domain.auth.db` lock and
  retry helper.
- `utility/db.py` has no users-database caller and is documented as
  jobs-persistence-only.
- No Phase 1 or later runtime behavior is introduced.

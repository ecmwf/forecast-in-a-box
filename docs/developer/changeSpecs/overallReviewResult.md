There are multiple subtasks in this file, each corresponding to fixing a particular style breach.

The subtasks are not related, you can use subagents per task.

There is no behaviour change, thus only syntactic or cosmetic changes to tests are expected. No new tests are expected.


## Section 1 — Import hierarchy violation: `routes` imports from `entrypoint`

**Guideline reference**: _High Level Code Organization_ — "Make sure you don't break importing
hierarchies: utility < schemata < domain < routes < entrypoint"

`routes/gateway.py` imports `launch_cascade` from `forecastbox.entrypoint.bootstrap.launchers`.
Routes must not depend on entrypoint; the hierarchy explicitly forbids this direction.

**Affected file and line**

| File | Line | Import |
|------|------|--------|
| `backend/src/forecastbox/routes/gateway.py` | 31 | `from forecastbox.entrypoint.bootstrap.launchers import launch_cascade` |

**Hint**: Move the `launch_cascade` function (or an appropriate subset of its logic) out of
`entrypoint` and into a lower layer — either `utility` or a dedicated `domain` module — so
that `routes/gateway.py` can import it without crossing the hierarchy boundary. An alternative
is to pass the function as a dependency/callable injected at startup, keeping `routes` free of
any entrypoint import.

Note: do *NOT* implement this right away -- propose one or more solutions first, then have the
user approve explicitly!

---

## Section 2 — Non-ORM classes declared in `schemata/user.py`

**Guideline reference**: _High Level Code Organization_ — "do not declare any functions in
these files, only the ORM classes themselves, and the function related to discovery:
`create_db_and_tables`"

`schemata/user.py` defines three pydantic request/response schemas (`UserRead`, `UserCreate`,
`UserUpdate`) alongside the ORM classes. These are not ORM classes; the guideline restricts
schemata files to ORM declarations only.

**Affected file and lines**

| File | Lines | Classes |
|------|-------|---------|
| `backend/src/forecastbox/schemata/user.py` | 25–33 | `UserRead`, `UserCreate`, `UserUpdate` |

**Hint**: Move `UserRead`, `UserCreate`, `UserUpdate` to the appropriate domain module (e.g.
`domain/auth/users.py` already imports from `schemata.user`, so it is a natural home) or to
`routes/auth.py` if they are purely a route contract. Update all import sites accordingly.
Note this is a refactor touching multiple files; verify that `fastapi_users` integration still
works after the move.

---

## Section 3 — Direct database session access in `routes/admin.py` bypasses the db lock

**Guideline reference**: _Concurrency Considerations_ — "When doing database access, you *must*
respect this lock, as all existing `db.py` submodules across domains do"

All domain `db.py` modules funnel writes through `dbRetry` (and reads through `querySingle` /
`dbRetry`), which internally acquires the `utility/db.py` async lock. The admin routes access
the user database by opening sessions directly from `schemata.user.async_session_maker` without
the lock, creating a potential concurrent-write race for the user SQLite file.

**Affected file and lines**

| File | Lines | Operation |
|------|-------|-----------|
| `backend/src/forecastbox/routes/admin.py` | 142–144 | `async with async_session_maker() as session:` (list users) |
| `backend/src/forecastbox/routes/admin.py` | 150–155 | direct session (get user) |
| `backend/src/forecastbox/routes/admin.py` | 161–164 | direct session (delete user) |
| `backend/src/forecastbox/routes/admin.py` | 174–184 | direct session (update user) |
| `backend/src/forecastbox/routes/admin.py` | 191–194 | direct session (patch user) |

**Hint**: Extract these operations into a `domain/auth/db.py` (or extend the existing
`domain/auth/users.py`) and wrap them with `dbRetry` from `utility/db.py`, as done in all
other domain db modules. The user and jobs databases are separate SQLite files, so a single
shared lock is conservative but consistent with the stated policy.

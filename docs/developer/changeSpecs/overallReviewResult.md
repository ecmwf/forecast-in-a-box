There are multiple subtasks in this file, each corresponding to fixing a particular style breach.

The subtasks are not related, you can use subagents per task.

There is no behaviour change, thus only syntactic or cosmetic changes to tests are expected. No new tests are expected.


## Section 1 — Non-ORM classes declared in `schemata/user.py`

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

## Section 2 — Direct database session access in `routes/admin.py` bypasses the db lock

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
shared lock is conservative but consistent with the stated policy. But add a comment on top
of the lock like # TODO we have one lock per two sqlite files -- overkill

# Backend concurrency rework: Phase 2 result

Result: Completed

Phase 2 was implemented as planned: the jobs SQLite database is now driven by a
synchronous SQLAlchemy engine (`schemata/jobs.py`) guarded by a single
`threading.RLock`-based retry wrapper (`utility/db.py`), all six jobs-database
helper modules were converted from `async def` to `def`, and every caller was
rewritten so that async services and routes submit jobs-DB calls through the
one-worker `ConcurrentPools.JobsDb` pool while synchronous pool workers and
long-lived threads (scheduler, plugin manager, run background submission) call
the locked helpers directly. `submit_run_sync` now provides the
async-independent run-submission boundary, with `execute` retained as a thin
async wrapper, and `experiment2runnable` was converted to a synchronous
operation. All jobs-DB usages of the retained event loop --
`asyncio.run_coroutine_threadsafe` bridges, stored loop references kept only
for DB work, and the shared jobs `asyncio.Lock` -- were removed. A follow-up
pass after the initial cutover consolidated the six independently-duplicated
`_await_jobs_db` aliases that services/routes had each defined locally into a
single public `execution_manager.await_jobs_db()` method, and restored a number
of comments and docstrings that were incidentally (and unnecessarily) trimmed
during the async-to-sync mechanical conversion; no behavioral deviation from
the plan resulted from either follow-up.

Developers of subsequent phases should be aware that: the users database
(`domain/auth/db.py`, `schemata/user.py`) is intentionally untouched and
remains fully async with its own lock, as scoped; executor-backed work other
than run submission (artifacts, plugin loading, stores, run-log ZIP, lens,
status probes) still runs on the default executor and is Phase 3's
responsibility to move onto named pools; thread ownership of the scheduler,
plugin updater, and run background loops is still ad hoc and is targeted for
consolidation into managed threads in Phase 3/4 -- Phase 2 only rewrote the
jobs-DB calls those threads make and the run-submission boundary they depend
on; and any new jobs-DB helper should call `execution_manager.await_jobs_db()`
from async contexts rather than introducing another local alias or reaching
for `ConcurrentPools.JobsDb`/`awaitable_submit` directly.

# Backend concurrency rework: Phase 3.4 implementation plan

## Purpose and scope

Finish the migration of run compilation and submission
(`domain/run/service.py`, `domain/run/background.py`, `domain/run/cascade.py`)
onto the managed `ConcurrentPools.RunSubmission` pool. Most of the mechanical
work (no event loop in the worker, synchronous locked jobs-DB calls, the
`submit_run_sync` boundary, monitored `RunSubmission` submission) was already
delivered by Phase 2. This phase closes the remaining gaps in failure
ownership and in the long artifact wait, and cleans up the background task
structure:

- the artifact wait is moved out of the gateway-submission helper into the
  background workflow, and made responsive to download failure and to a stop
  request;
- a rejected `RunSubmission` enqueue no longer leaves an orphaned `submitted`
  run row;
- the repeated "mark failed, or reconcile if the CAS lost" code is factored
  into one helper.

Splitting the run workflow into several chained pool tasks is explicitly not
part of this phase; it is only marked with a TODO (step 5).

### Original design references

Look at these original files only if you encounter an unexpected situation.
This plan is self-contained and implementation should not normally require
reading them.

- [`backend-concurrencyRework-design.md`](backend-concurrencyRework-design.md)
- [`backend-concurrencyRework-migration.md`](backend-concurrencyRework-migration.md) (section "3.4 Run compilation and submission")
- [`backend-concurrencyRework-phase2-result.md`](backend-concurrencyRework-phase2-result.md)
- [`backend-concurrencyRework-phase3.1-plan.md`](backend-concurrencyRework-phase3.1-plan.md)

## Delivered baseline you can rely on

- `domain/run/service.py`:
  - `submit_run_sync(...)` performs one locked `run_db.upsert_run(...)` and then
    `execution_manager.submit_monitored(ConcurrentPools.RunSubmission,
    TaskName("run.submit.execute"), partial(execute_background, ...))`, and
    returns `Either.ok(ExecuteResult)` immediately;
  - `async execute(...)` is a thin wrapper that runs `submit_run_sync` on
    `ConcurrentPools.General` via `awaitable_submit`; `restart_run` and
    `routes/run.py::create_run` go through it;
  - the scheduler thread (`domain/experiment/scheduling/background.py`) calls
    `submit_run_sync` directly and logs an `Either.error`. An exception raised
    from `submit_run_sync` propagates out of the scheduler iteration and
    terminates the scheduler thread.
- `domain/run/background.py::execute_background` runs on a `RunSubmission`
  worker, calls jobs-DB helpers directly, does compare-and-swap status writes
  (`submitted -> preparing -> ...`), catches every exception and records a
  `failed` run state, and handles stop/delete races around submission via
  `_abort_if_not_proceeding`.
- No event-loop parameter, `run_async`, `run_coroutine_threadsafe`, or default
  executor remains in the run domain (verify with a grep; nothing to do if
  clean).
- Phase 3.1 (delivered before this phase): artifact downloads run on the
  one-worker `ConcurrentPools.ArtifactIo` pool as monitored tasks;
  `submit_artifact_download(composite_id, retry=False) -> Either[int, str]`
  reserves `ongoing_downloads[id] = 0` and raises `SubmissionRejected` (after
  removing the reservation) if the pool rejects. A failed download leaves
  `ongoing_downloads[id] = "<error string>"`. Downloads abort on application
  shutdown because the http pools / SSH tunnels are closed before the
  execution runtime stops.
- Pools: `RunSubmission` defaults to 2 workers / 32 pending, `General` to 2 /
  32, `ArtifactIo` to 1 / 64.

## Current state to change

`domain/run/cascade.py::execute_cascade(spec)` mixes two concerns:

1. waiting for runtime artifacts: it calls `submit_artifact_download` for each
   missing artifact, then busy-polls `ArtifactManager.locally_available` every
   second for up to 3600 seconds. It does not notice a failed download (the run
   waits the full hour and then fails with a generic timeout), and it does not
   notice that the run was stopped or deleted meanwhile;
2. building the cascade infrastructure spec and submitting the job to the
   gateway.

Other observations:

- `_build_infra_spec`'s final `else` branch calls `assert_never(request_infra)`
  -- both names are undefined in that module (a latent `NameError`).
- `submit_run_sync` inserts the run row and then submits; if
  `submit_monitored` raises `SubmissionRejected` (pool full or shutting down),
  the row stays `submitted` forever with no worker attached, and the exception
  either becomes a 503 (route) or kills the scheduler thread.
- `execute_background` contains the "write failed with CAS, else reconcile"
  sequence twice (gateway error response, generic exception).
- Module docstrings still say "Runs on a worker thread".

## Target behaviour

```text
route / scheduler
  -> submit_run_sync                       (General worker or scheduler thread)
       upsert_run (locked)                 status = submitted
       submit_monitored(RunSubmission, "run.submit.execute")
         on SubmissionRejected: mark run failed, return Either.error
  -> execute_background                    (RunSubmission worker)
       resolve glyphs, compile             (CPU, locked DB reads)
       CAS submitted -> preparing
       abort check
       _await_runtime_artifacts            (downloads on ArtifactIo; wait here)
         -> failure / timeout: mark failed
         -> run stopped or deleted: return
       abort check
       execute_cascade                     (gateway submit only)
       persist cascade job id, post-submit stop/delete handling (unchanged)
```

The waiter remains on `RunSubmission` and the download on `ArtifactIo`; they
must never share a pool (a waiter could otherwise occupy the only worker its
own download needs). Add a one-line comment saying so where the wait happens.

Business failures (compilation error, gateway rejection, failed artifact,
timeout) are recorded in the run row and are a normal task completion; they
are not re-raised, so the manager's bounded `monitored_failures` history is not
flooded by user-level run failures. Only an exception escaping the
failure-recording itself (for example the jobs DB being unavailable) reaches
the manager's monitoring. Document this in `execute_background`'s docstring.

## Implementation steps

### 1. Artifact domain: one read helper

In `domain/artifact/manager.py` add a small status read used by the waiter:

```python
@dataclass(frozen=True, eq=True, slots=True)
class ArtifactDownloadStatus:
    state: Literal["available", "downloading", "failed", "absent"]
    progress: int | None = None
    error: str | None = None


def get_download_status(composite_id: CompositeArtifactId) -> ArtifactDownloadStatus:
    """..."""
```

It reads `locally_available` and `ongoing_downloads` under the existing
`ArtifactManager.lock` with the short request timeout, so the two fields are
observed consistently; it raises `TimeoutError` if the lock cannot be taken
(callers treat that as "try again next poll"). `available` takes precedence;
an `int` entry is `downloading`, a `str` entry is `failed`, neither is
`absent`. This is intended for synchronous worker threads; do not call it from
the event loop.

Do not change any other artifact behaviour in this phase.

### 2. `domain/run/cascade.py`: submission only

1. Remove the artifact block (download submission and polling) from
   `execute_cascade`, together with the `ArtifactManager` /
   `submit_artifact_download` / `time` imports. `execute_cascade` keeps its
   name and contract: build the infra spec, submit `SubmitJobRequest`, convert
   any gateway exception into `SubmitJobResponse(job_id=None, error=repr(e))`.
   Update its docstring (runtime artifacts must already be available).
2. Fix the `_build_infra_spec` fall-through: import `assert_never` (from
   `typing`, or `cascade.low.func` as elsewhere in the codebase) and call it on
   `requested_infra`.

### 3. `domain/run/background.py`: artifact wait and failure helper

1. Add a private helper that implements the existing failure pattern once:

   ```python
   def _mark_failed(run_id, attempt_count, current_status, error: str) -> None:
       if not db.update_run_runtime(run_id, attempt_count, expected_status=current_status,
                                    status="failed", error=error[:255]):
           # lost to a concurrent stop or deletion
           _abort_if_not_proceeding(run_id, attempt_count, expected=current_status)
   ```

   Use it in the gateway-error branch and in the generic `except` branch
   (both currently inline the same sequence).
2. Add `_await_runtime_artifacts(run_id, attempt_count, artifacts) -> _ArtifactWait`
   where

   ```python
   @dataclass(frozen=True, eq=True, slots=True)
   class _ArtifactWait:
       aborted: bool = False      # run stopped/deleted meanwhile; caller returns silently
       error: str | None = None   # caller marks the run failed with this message
   ```

   (both default -> all artifacts available). It raises nothing for expected
   outcomes. Use module-level constants
   `ARTIFACT_WAIT_TIMEOUT_SECONDS = 3600`,
   `ARTIFACT_POLL_INTERVAL_SECONDS = 1.0`, and
   `RUN_STATUS_CHECK_INTERVAL_SECONDS = 10.0`. Behaviour:
   - for each artifact not yet `available`, call
     `submit_artifact_download(artifact_id, retry=False)` -- pass `retry=False`
     explicitly. A previously failed download is therefore *not* retried by a
     run: `submit_artifact_download` returns `Either.error` with the earlier
     failure, which becomes
     `_ArtifactWait(error="Failed to submit download for <id>: ...")` and the
     run fails. A failed download must always be cleared explicitly by the
     user (artifacts route with `retry=True`), never implicitly by a run that
     assumed the artifact to be present; implicit retries would also add load
     to the already oversubscribable `RunSubmission`/`ArtifactIo` workers.
     `SubmissionRejected` is allowed to propagate (the generic `except` marks
     the run failed);
   - poll `get_download_status` for the remaining artifacts every
     `ARTIFACT_POLL_INTERVAL_SECONDS` (`time.sleep`; a `TimeoutError` from the
     helper just skips that poll);
     - all `available` -> `_ArtifactWait()`;
     - any `failed` -> `error="Runtime artifact <id> failed to download: <error>"`;
     - any `absent` (for example deleted meanwhile) -> `error=`
       `"Runtime artifact <id> is no longer available"`;
     - elapsed > timeout -> `error=` the existing timeout message;
   - every `RUN_STATUS_CHECK_INTERVAL_SECONDS`, call
     `_abort_if_not_proceeding(run_id, attempt_count, expected="preparing")`;
     if it returns `True`, return `_ArtifactWait(aborted=True)` (the helper
     already moved `stopping -> stopped`).
3. In `execute_background`, after the existing
   `_abort_if_not_proceeding(..., expected="preparing")` check and before
   `execute_cascade`:

   ```python
   runtime_artifacts = compilation_result.execution_spec.environment.runtime_artifacts
   if runtime_artifacts:
       # NOTE the wait occupies this RunSubmission worker while downloads run on ArtifactIo
       # TODO move the artifact download to the correct pool and chain with submit_after
       outcome = _await_runtime_artifacts(run_id, attempt_count, runtime_artifacts)
       if outcome.aborted:
           return
       if outcome.error is not None:
           _mark_failed(run_id, attempt_count, current_status, outcome.error)
           return
       if _abort_if_not_proceeding(run_id, attempt_count, expected="preparing"):
           return
   ```

4. Update the module docstring: the task runs on `ConcurrentPools.RunSubmission`;
   it may wait (bounded) for runtime artifacts downloaded on
   `ConcurrentPools.ArtifactIo`; business failures are recorded in the run row.

### 4. `domain/run/service.py`: rejected enqueue

In `submit_run_sync`, wrap the `submit_monitored` call:

```python
try:
    execution_manager.submit_monitored(...)
except SubmissionRejected as e:
    logger.warning(...)
    run_db.update_run_runtime(new_run_id, attempt_count, expected_status="submitted",
                              status="failed", error=f"run submission rejected: {e}"[:255])
    return Either.error(f"Run submission rejected, try again later: {e}")
```

This keeps the invariant that every accepted run row reaches a terminal or
progressing state, keeps the scheduler thread alive, and lets the route return
its existing "Failed to execute" error. Update the docstring of
`submit_run_sync` to state this.

`execute` (the async wrapper on `General`) stays as is.

### 5. TODO markers for deferred work

Add these two comments verbatim; they mark known gaps that are deliberately
not addressed in this phase:

1. In `domain/run/background.py::execute_background`, at the
   `_await_runtime_artifacts` call site (shown in step 3):

   ```python
   # TODO move the artifact download to the correct pool and chain with submit_after
   ```

   A run waiting for an hour-long download holds one of the two
   `RunSubmission` workers; two such runs block all other run submissions
   (they queue, up to 32). The proper fix is splitting the workflow into
   chained tasks (`submit_after`, and a group variant for multiple
   artifacts), which is deferred. Until then `RunSubmission.max_workers` is
   the tuning knob.
2. In `domain/run/service.py::_poll_and_update_once`, at the branch that only
   polls the gateway for runs that have a `cascade_job_id`:

   ```python
   # TODO handle jobs with inactive cascade_proc_id -- either in poll_and_update, or in a db tombstone cleaner
   ```

   Runs left in `submitted`/`preparing` after a backend restart (or still
   queued at shutdown) are never reconciled today; the intended handling is
   to compare their `cascade_proc` with the currently active gateway process
   and flag the ones belonging to an inactive gateway. Out of scope here.

### 6. Documentation

- `domain/run/__init__.py` needs no change.
- `backend/development.md`: the bullet listing pre-existing ad hoc threads
  ("scheduler, plugin updater, run background submission") is outdated --
  the plugin updater was migrated in Phase 3.2/3.3 and run background
  submission in Phase 2. Reduce the list to the scheduler.

## Tests and validation

Unit tests (new file `tests/unit/domain/run/test_background.py`, plus updates
to `test_cascade.py`); patch `db`, `compile_builder`, `execute_cascade`,
`submit_artifact_download`, `get_download_status`, and `time.sleep`/monotonic
time so no test sleeps for real:

1. `execute_cascade` no longer touches the artifact manager; existing
   infra-selection tests still pass; the unknown-infra branch raises an
   assertion-type error rather than `NameError`.
2. `_await_runtime_artifacts`:
   - returns `_ArtifactWait()` once all artifacts become `available`;
   - returns a failure message promptly when one artifact turns `failed`
     (no waiting for the timeout);
   - returns the timeout message when the clock passes the limit;
   - returns `aborted=True` when `_abort_if_not_proceeding` reports a stop;
   - submits downloads with `retry=False` only for artifacts not yet
     available, and fails the run with the earlier error when an artifact
     already has a failed download recorded (no implicit retry).
3. `execute_background`:
   - a failed artifact wait marks the run `failed` with the message and never
     calls `execute_cascade`;
   - a stop during the wait results in no `failed` write and no
     `execute_cascade` call;
   - unchanged: gateway error -> `failed`; exception -> `failed`.
4. `submit_run_sync`: when `submit_monitored` raises `SubmissionRejected`, the
   run row is updated to `failed` (CAS from `submitted`) and an `Either.error`
   is returned; no exception escapes.
5. Integration: `tests/integration/test_blueprint.py::test_blueprint_artifact_execute`
   covers the full artifact-dependent run path; run it along with the other
   run integration tests. Manually (or with a quick throwaway test) verify a
   run whose artifact download fails is marked `failed` within seconds.
6. Type checking, run-domain unit tests, integration tests, `uv run prek`.

## Completion criteria

- `execute_cascade` performs only gateway submission; the artifact wait lives
  in the background workflow, detects failed/vanished downloads, honours a
  stop request, and is bounded.
- No code path can leave a freshly inserted run in `submitted` without a
  queued `RunSubmission` task.
- `RunSubmission` remains the only pool for run background work; no
  default-executor, loop reference, or `run_coroutine_threadsafe` in the run
  domain.

## Outdated information in the original documents

- The migration expects this phase to "confirm" the removal of the loop
  parameter and `run_async`; both were removed in Phase 2 and nothing remains.
- The migration describes `submit_run_sync` as returning an `Either` and the
  task as "monitored"; that is in place. The orphaned-row-on-rejection gap is
  not mentioned there.
- `cascade.py` is described as part of compile/submit; it is now gateway
  submission only.

## Notes and caveats

These are informational; none of them requires action in this phase.

1. Queued `RunSubmission` tasks are not cancelled at shutdown (no action): the
   pool closes with `cancel_futures=False`, so queued tasks will run against
   an already stopped gateway and be marked failed. This is accepted, in line
   with the rule that pending work is not silently discarded.

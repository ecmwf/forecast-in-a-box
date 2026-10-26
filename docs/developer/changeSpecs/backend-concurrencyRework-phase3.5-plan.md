# Backend concurrency rework: Phase 3.5 implementation plan

## Purpose and scope

Move the creation of the run-logs ZIP archive (`GET /api/v1/run/logs`) off the
asyncio default executor and onto named execution-manager pools, and move the
blocking gateway query that precedes it off the event loop. While doing so,
move the archive-building logic out of `routes/run.py` into the run domain, so
the route only resolves the run, awaits the domain call, and maps the result
to a response.

This is a small, self-contained change. Other blocking calls in
`routes/run.py` (`/delete`, `/outputContent`, the gateway polling done by
`/get` and `/list`) are handled in Phase 3.6, not here.

### Original design references

Look at these original files only if you encounter an unexpected situation.
This plan is self-contained and implementation should not normally require
reading them.

- [`backend-concurrencyRework-design.md`](backend-concurrencyRework-design.md)
- [`backend-concurrencyRework-migration.md`](backend-concurrencyRework-migration.md) (section "3.5 Run log archive creation")

## Delivered baseline you can rely on

- `execution_manager.awaitable_submit(pool, TaskName(...), task) -> T` runs a
  synchronous zero-argument callable on a named pool and awaits it without
  blocking the event loop; exceptions raised by the task are re-raised to the
  awaiting coroutine. `SubmissionRejected` (pool full / shutting down)
  becomes HTTP 503 through the common handler in `utility/fastapi.py`.
- Pools: `ConcurrentPools.Io` (4 workers) for network/disk transfers and archive creation,
  `ConcurrentPools.General` (2 workers) for short blocking work such as
  light gateway queries.
- Unit tests have an autouse inline fake for `awaitable_submit`
  (`tests/unit/conftest.py`), which simply runs the task.

## Current state

`routes/run.py::_build_run_logs_response(cascade_job_id, db_entity_ser)`:

1. calls `cascade.gateway.client.request_response(JobProgressRequest(...))`
   directly on the event loop (blocking ZMQ round-trip, default 1 s timeout);
   a `TimeoutError` or any other exception is embedded into the archive as
   `gw_state = {"progresses": {}, "datasets": {}, "error": ...}` instead of
   failing the request;
2. defines a nested `_build_zip()` that writes `db_entity.json`,
   `gw_state.json`, and matching files from the gateway logs directory
   (`backend.logs.txt`, `gateway*`, `job_<id>*`) into an in-memory ZIP, and
   returns `(bytes, "")` or `(b"", repr(error))`;
3. runs `_build_zip` through `loop.run_in_executor(None, ...)`;
4. returns `200 application/zip`, or `500 text/plain` with the error string.

There is also a small bug: the `logs_directory.error.txt` entry for a missing
logs directory is written with a plain string literal that lacks the `f`
prefix, so the placeholder `{maybe_logs_directory.e}` is written verbatim.

## Target

New module `backend/src/forecastbox/domain/run/logs.py` (domain logic only, no
FastAPI imports):

```python
def fetch_gateway_job_state(cascade_job_id: str) -> dict:
    """Blocking gateway query; never raises -- errors are embedded as before."""

def build_logs_archive(cascade_job_id: str, db_entity_ser: bytes, gw_state: dict) -> bytes:
    """Blocking disk work; raises RunLogsArchiveFailed on failure."""

async def get_run_logs_archive(run: RunRecord) -> bytes:
    """Awaits fetch on ConcurrentPools.General, then the archive on ConcurrentPools.Io."""
```

- `fetch_gateway_job_state` is the current step 1 moved verbatim (same
  `JobProgressRequest`, same error embedding).
- `build_logs_archive` is the current `_build_zip` body with the `f`-string
  fix. Instead of returning an `(bytes, error)` tuple it raises a new
  `RunLogsArchiveFailed(Exception)` (add to `domain/run/exceptions.py`, with a
  one-line docstring) chained from the original exception, after
  `logger.exception(...)`. Partial-failure behaviour inside the archive is
  unchanged: a failure while listing/adding log files still only adds
  `logs_directory.error.txt` and does not fail the archive.
- `get_run_logs_archive` serializes the record exactly as the route does today
  (`orjson.dumps(asdict(run))`), requires `run.cascade_job_id` to be set (the
  route keeps the existing 409 check before calling it), and does:

  ```python
  gw_state = await execution_manager.awaitable_submit(
      ConcurrentPools.General,
      TaskName("run.logs.gateway-state"),
      partial(fetch_gateway_job_state, cascade_job_id),
  )
  return await execution_manager.awaitable_submit(
      ConcurrentPools.Io,
      TaskName("run.logs.build-archive"),
      partial(build_logs_archive, cascade_job_id, db_entity_ser, gw_state),
  )
  ```

  The gateway query goes to `General` because it is a light request whose
  latency comes from waiting on a possibly busy gateway; the archive goes to
  `Io` because it is disk reading plus compression.
  Two separate awaits keep each pool's occupancy to its own kind of work.

`routes/run.py`:

- delete `_build_run_logs_response`, and the now unused `asyncio`, `io`,
  `os`, `pathlib`, `zipfile`, and `get_logs_directory` imports (check each is
  really unused; `api`/`client` are still used by `/outputContent`);
- `get_run_logs` becomes:

  ```python
  run_record = await _resolve_run_record(spec, auth_context)
  if run_record.cascade_job_id is None:
      raise HTTPException(status_code=409, ...)          # unchanged
  try:
      archive = await get_run_logs_archive(run_record)
  except RunLogsArchiveFailed as e:
      return Response(content=repr(e.__cause__ or e), status_code=500, media_type="text/plain")
  return Response(content=archive, status_code=200, media_type="application/zip")
  ```

  The response contract (status codes, media types, archive member names) is
  unchanged.

Update the `domain/run/service.py` module docstring, which lists "logs
packaging" among its responsibilities: point to `domain/run/logs.py` instead.

## Tests and validation

1. New `tests/unit/domain/run/test_logs.py`:
   - `fetch_gateway_job_state` embeds `TimeoutError` and generic exceptions as
     the `error` field (patch `client.request_response` / `get_gateway_url`);
   - `build_logs_archive` with a temporary logs directory (patch
     `get_logs_directory`) contains `db_entity.json`, `gw_state.json`, the
     matching log files, and excludes non-matching files;
   - a missing logs directory yields `logs_directory.error.txt` containing the
     actual error text (regression test for the f-string fix);
   - `get_run_logs_archive` submits `run.logs.gateway-state` to
     `ConcurrentPools.General` and `run.logs.build-archive` to
     `ConcurrentPools.Io` (patch `execution_manager.awaitable_submit` with
     a recording fake for this test).
2. Integration: `tests/integration/test_blueprint.py` already downloads
   `/run/logs` for a completed run; run it.
3. Type checking, unit tests, integration tests, `uv run prek`. Grep:
   `run_in_executor` must have no hits in `backend/src`.

## Completion criteria

- `/run/logs` performs no blocking work on the event loop and no default
  executor submission; the gateway query and the archive appear as
  `run.logs.gateway-state` (`General`) and `run.logs.build-archive` (`Io`)
  activity in `/api/v1/status` pool counters.
- The archive-building logic lives in `domain/run/logs.py`; the route is a
  thin mapping layer with an unchanged response contract.

## Outdated information in the original documents

- The migration shows a single `awaitable_submit(General, ..., _build_zip)` and
  leaves the gateway query placement open; this plan decides on `General` for the
  query and `Io` for the archive. The output directory zip (`/outputContent`) is
  also moved to `domain/run/logs.py` and runs on `Io` as `run.output.build-archive`.

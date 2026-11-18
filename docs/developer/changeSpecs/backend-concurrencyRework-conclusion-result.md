# Backend concurrency rework: conclusion result

Implementation of `backend-concurrencyRework-conclusion-plan.md`. Only deviations from the plan
and items not addressed are listed here; everything else was implemented as planned.

## Deviations

- Task 2: instead of deleting `test_submit_load_all_uses_submit_after_not_delayed_thread`
  entirely, only the `delayed_thread` guard assertion was removed and the test was renamed to
  `test_submit_load_all_uses_submit_after`. Its remaining assertions (dependency future, pool, task
  name, reservation, readiness) are not covered elsewhere.
- Task 4: the execution runtime keeps a single start step (`execution_runtime`, registration plus
  `execution_manager.start`, stop closes the pools via `shutdown`) and gets a stop-only
  `execution_threads` step (`stop_threads`). The broadcaster is split into a start-only
  `broadcaster` step (before `execution_runtime`, so the loop is set before the dispatcher runs)
  and a stop-only `broadcaster_stop` step (unwound after the threads and before the http pools).
  `providers` (formerly `fiabcore_providers`, now also registering the template hooks) moved to
  right after `db_schema`. The resulting unwind order matches the plan.
- Task 11 (R-4): `catalogue_view` was simplified to return only the dict (the plan said to keep
  the `| bool` signature); the only caller, `routes/blueprint.py::get_catalogue`, no longer
  handles the `bool` case.
- Task 11 (R-7): besides clearing `wake`, `scheduler_entrypoint` now returns immediately if the
  stop event is already set after the clear -- otherwise a stop requested before the clear would
  leave the gate wait (which has no timeout) blocked.
- Task 1 tests: the warmup guard test lives in
  `tests/unit/domain/plugins/test_plugin_loading_hooks.py` (renamed from
  `test_plugin_loading_events.py`) as
  `test_update_single_works_without_runtime_via_entrypoint_registration`.

## Not addressed

- Task 12: `docs/developer/changeSpecs/overallReviewState.md` was not updated, since documents in
  `docs/developer/changeSpecs` were to be left untouched. Its "DB access / concurrency" bullet is
  outdated and its "hierarchy-breaching imports inside functions in domain.plugin" bullet is
  resolved.

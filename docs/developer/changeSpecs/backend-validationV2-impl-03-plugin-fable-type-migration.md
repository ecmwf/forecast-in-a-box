# Task 3: Migrate plugins to FableType declarations

## Goal

Update all plugin catalogue `value_type` declarations to the accepted `FableType` syntax. Do not change backend validation, compilation, or plugin assumptions about the runtime type of configuration values.

After this task, plugins should still receive string configuration values exactly as they do before task 4.

## Expected scope

- Update `fiab-plugin-test` catalogue values.
- Update `fiab-plugin-ecmwf` catalogue values.
- Update any helper-generated enum type strings, such as checkpoint enum helpers.
- Update any tests that assert exact catalogue type strings, if present.
- Update `backend-validationV2-frontendImpact.md` with exact before/after catalogue examples after the migration is implemented.

## Constraints

- This task is catalogue-only. Existing behavior and tests should continue to pass.
- Do not call `validate_convert` in the backend.
- Do not remove plugin-side string parsing such as `int(...)`, `float(...)`, or list parsing helpers.
- Do not make assumptions that `BlockInstance.configuration_values` contains converted values.
- Migrate current `enum[...]` declarations to `enumClosed[...]`.
- Migrate current `date-iso8601` declarations to `date`; the ISO format belongs in `FableType` documentation, not in the type name.
- Migrate the current `optional[int]` declaration to `int`. Do not solve the plugin's internal `None`/missing handling in this task.
- Keep existing `list[int]` and other `list[...]` declarations when they already match the canonical syntax.
- Do not preserve backward compatibility for old catalogue strings at the catalogue level.

## Non-goals

- No backend route changes.
- No new integration tests are expected unless an existing assertion needs to be updated.
- No frontend code changes.

## Frontend impact note

This task changes `value_type` strings returned by `GET /blueprint/catalogue`. Update `backend-validationV2-frontendImpact.md` with exact before/after examples from the final implementation.

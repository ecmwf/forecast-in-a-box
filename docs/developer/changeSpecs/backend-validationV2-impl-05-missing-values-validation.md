# Task 5: Ignore missing configuration values during validation

## Goal

During backend validation, missing configuration values should not be reported as hard validation errors. The affected option should simply be absent from the converted block passed to the plugin validator.

During compilation, missing configuration values remain a hard failure and the plugin compiler must not be called for the affected block.

## Expected scope

- Change validation behavior in `forecastbox.domain.blueprint.service.validate_expand` so missing configuration values no longer add `block_errors`.
- Ensure converted configuration passed to plugin validation excludes missing options.
- Preserve strict compilation behavior in `forecastbox.domain.run.compile.compile_builder`: missing required configuration values should fail before plugin compilation.
- Keep existing extra-configuration handling.
- Keep existing type-conversion failure behavior from task 4.

## Constraints

- Focus on the backend behavior. Do not attempt to make every plugin gracefully handle missing values in this task.
- If a plugin crashes because it indexes a missing value during validation, that can remain a plugin issue for later cleanup unless it breaks existing tests.
- Missing values should not be silently defaulted by the backend.
- Plugin-provided `default_value` remains a frontend responsibility to inject.
- `None` should not be treated as an acceptable missing-value representation unless a later task explicitly changes the contract.

## Non-goals

- No frontend code changes.
- No new warning field for missing configuration values.
- No plugin-wide defensive refactor.
- No unknown glyph changes.

## Frontend impact note

This task changes validation semantics for `PUT /blueprint/expand`, `POST /blueprint/create`, and `POST /blueprint/update`. Update `backend-validationV2-frontendImpact.md` if the exact behavior differs from the examples there.


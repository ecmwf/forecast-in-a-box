# Task 4: Validate and convert configuration values in the backend

## Goal

Call `FableType.validate_convert` before plugin validation and before plugin compilation. Migrate plugin code to assume configuration values are already converted when the backend invokes validators and compilers.

Do not change missing-option handling in this task.

## Expected scope

- Add a backend helper that, for a block instance and its block factory, validates known configuration values against their declared `value_type`.
- Use that helper in `forecastbox.domain.blueprint.service.validate_expand` before calling `plugin.validator`.
- Use the same conversion behavior in `forecastbox.domain.run.compile.compile_builder` before calling `plugin.compiler` and before the defensive validator call used to derive outputs.
- Ensure type conversion failures prevent the plugin validator/compiler from being called for that block.
- Widen `BlockInstance.configuration_values` to `dict[str, Any]`.
- Migrate `fiab-plugin-test` and `fiab-plugin-ecmwf` validation/compile code to consume converted values.

## Constraints

- Missing required configuration values should behave as they did before this task. Do not implement validation-time omission yet.
- Extra configuration values should continue to be reported according to existing behavior.
- Glyph resolution must still happen before type conversion.
- Conversion must not mutate the caller's blueprint unexpectedly when the route is validation-only. Follow existing copy/mutation behavior carefully.
- Widening `BlockInstance.configuration_values` to `dict[str, Any]` is the intended simple approach for this task. Keep external request/response compatibility by ensuring raw API input still accepts serialized strings before conversion.
- `FableType.validate_convert` should accept `Any` but must raise `TypeError` when the value is not a string; backend conversion should only call it on raw serialized values.
- Avoid unsafe casts that hide converted-value typing issues.
- Plugin code should not keep redundant parsing for values the backend now converts, except where a default/fallback path still receives a plugin-owned literal.
- Existing integration tests, especially `backend/tests/integration/test_blueprint.py`, should continue to cover the main behavior.

## Non-goals

- Do not change missing-value behavior.
- Do not introduce `BlockExpansion`.
- Do not implement expansion restrictions.
- Do not change unknown glyph handling.
- Do not add a broad new test suite if existing integration coverage exercises the behavior. Focused fixes to existing tests are acceptable if exact error strings or types change.

## Frontend impact note

This task can change validation error timing and wording. Update `backend-validationV2-frontendImpact.md` if the final API response examples differ from the placeholder examples there.

# Task 2: Introduce FableType

## Goal

Add a `FableType` class in the `fiab_core.types` submodule and unit-test its `validate_convert` behavior. Do not wire it into plugins, backend validation, or backend compilation yet.

## Expected scope

- Add `backend/packages/fiab-core/src/fiab_core/types.py`.
- Implement parsing and strict validation for the agreed type syntax.
- Expose a `validate_convert` method or function that accepts `Any` and either returns the converted value or raises/returns a clear validation error according to the pattern chosen in the implementation.
- Add focused unit tests in `fiab-core` for conversion behavior.

The type set should cover the proposal:

- `str`
- `int`
- `float`
- `date`
- `datetime`
- `list[FableType]`
- closed enum
- open enum

## Constraints

- The canonical syntax for closed enums is `enumClosed[...]`; the canonical syntax for open enums is `enumOpen[...]`.
- The canonical date type is `date`, not `date-iso8601`.
- `datetime` remains the canonical datetime type.
- `list[int]` and other `list[FableType]` expressions are legitimate.
- Optional types such as `optional[int]` are not part of the type system.
- `validate_convert` must check internally that the provided value is a string and raise `TypeError` otherwise. This supports the later `BlockInstance.configuration_values: dict[str, Any]` widening while keeping conversion inputs strict.
- Date and datetime formats must be single, deterministic ISO formats, documented in the type docstrings.
- For `str` and open enum, conversion should be a no-op except for validation that the type expression itself is valid.
- For closed enum, conversion should keep the original string but validate membership.
- For list types, tests should cover valid lists, invalid item conversion, empty input behavior, and whitespace behavior.
- Tests should cover non-string input to `validate_convert`.
- Error messages should be useful to callers but tests should avoid over-specifying incidental wording unless the project already does so.

## Non-goals

- Do not change `BlockConfigurationOption.value_type` yet unless the type annotation can be changed without touching existing plugin declarations.
- Do not migrate any plugin catalogue values.
- Do not call `validate_convert` from backend validation or compilation.
- Do not create the future cross-language CSV compliance suite.
- Do not implement numerical ranges, temporal comparisons, regexes, or plugin-specific validation in `FableType`.

## Frontend impact note

This task should normally have no frontend-visible impact. If the implementation exposes generated docs or schemas that include `FableType`, update `backend-validationV2-frontendImpact.md`.

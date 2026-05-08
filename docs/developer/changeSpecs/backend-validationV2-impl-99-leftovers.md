# Backend Validation V2 leftovers

This file tracks items from the original specs that are intentionally not covered by tasks 1 through 8.

## Expand left

The original spec discusses future "expand left" behavior:

- starting from a product block and suggesting source blocks for its inputs
- connecting an existing product and source block
- replacing an existing arrow with a transform block
- changing expand from `expand(input)` to something like `expand(input?, output?)`

This is not included in the staged implementation. Tasks 6 and 7 only change the existing expansion result shape and add configuration restrictions to current rightward expansion behavior.

## Cross-language type compliance suite

The original spec mentions a CSV-style compliance suite for comparing backend and frontend type understanding, with columns such as:

- literal value
- Python evaluation input
- JavaScript evaluation input

Task 2 only adds Python unit tests for `FableType.validate_convert`. A standalone backend/frontend compliance suite remains future work.

## Frontend type validation and completion

The user story includes `client_type_understanding`: frontend-side validation and completion based on `value_type`, constrained expansion restrictions, and glyph behavior.

The staged backend tasks deliberately do not require reading or modifying the frontend codebase. Frontend-visible backend changes are documented in `backend-validationV2-frontendImpact.md` so frontend work can be planned separately.

## Blueprint readiness metadata

Task 5 deliberately allows validation and blueprint persistence to accept incomplete blueprints when the only issue is missing configuration values. Task 8 similarly allows validation to proceed when configuration values reference missing glyphs.

A future persistence-level metadata flag should record whether a saved blueprint is ready for compilation, meaning it has no missing configuration options and no missing glyphs. That metadata is not part of tasks 1 through 8.

## Plugin-wide missing-value resilience

Task 5 changes backend validation so missing configuration values are omitted before plugin validation, but it explicitly does not require every plugin to gracefully handle the missing values. If important plugin validators still crash or produce poor warnings for incomplete blocks, that cleanup should be handled separately.

## Richer type system features

The spec explicitly excludes pandera/pydantic-like validations. These remain out of scope:

- numeric ranges
- temporal comparisons
- regex/string constraints
- cross-field validation
- plugin-specific semantic validation inside `FableType`

Such validation should remain plugin-owned.

## None and optional semantics

The proposal says `None` should not be a normal accepted value and suggests not adding `allow_none`. Existing plugin declarations that currently use `optional[int]` should be exposed as `int` during task 3. Any remaining internal plugin handling of missing values or `None` is not otherwise addressed by tasks 1 through 8.

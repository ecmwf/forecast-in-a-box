# Task 1: Introduce ConfigurationOptionId

## Goal

Introduce a `ConfigurationOptionId` `NewType` in the core Fable contract and use it where configuration option keys are represented in backend/core/plugin-facing types.

This is intentionally a small typing cleanup. It should not change runtime behavior or JSON payloads.

## Expected scope

- Add `ConfigurationOptionId = NewType("ConfigurationOptionId", str)` near the other Fable ids in `fiab_core.fable`.
- Update core model annotations such as:
  - `BlockFactory.configuration_options`
  - `BlockInstance.configuration_values`
  - any new or existing restriction mapping types that are already in scope for this task
- Update imports and obvious local annotations in backend and plugin code where the type checker requires it.
- Preserve string serialization/deserialization for JSON.

## Constraints

- Keep this task limited to typing and imports.
- Do not introduce `FableType`.
- Do not change plugin `value_type` strings.
- Do not change validation behavior.
- Do not change expand response shape.
- Avoid broad casts; use `ConfigurationOptionId(...)` at construction boundaries where needed.

## Non-goals

- No new standalone tests are required if existing tests continue to pass.
- No plugin behavior changes.
- No frontend work.

## Frontend impact note

This task should record "no frontend impact" in `backend-validationV2-frontendImpact.md` if the implementation PR updates the impact file.


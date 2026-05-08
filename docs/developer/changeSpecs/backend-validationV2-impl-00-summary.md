# Backend Validation V2 implementation summary

This document breaks `backend-validationV2.md` and `backend-validationV2.proposal01.md` into small implementation tasks intended to be independently mergeable. Each task should preserve existing behavior unless that task explicitly changes the contract.

The guiding sequence is:

1. Introduce `ConfigurationOptionId`.
2. Introduce `FableType` and its unit tests, without wiring it into plugins or backend validation.
3. Migrate plugin catalogue declarations to `FableType` values.
4. Convert configuration values before plugin validation and compilation.
5. Treat missing configuration values as validation warnings by omission, while keeping compilation strict.
6. Change expand contract to return `BlockExpansion` with empty restrictions.
7. Exercise `ConfigurationOptionRestriction` in `fiab-plugin-test` and integration tests.
8. Treat unknown glyphs like missing configuration values during validation, while keeping compilation strict.

## Task documents

| Task | Document | Main outcome |
| --- | --- | --- |
| 1 | `backend-validationV2-impl-01-configuration-option-id.md` | Add `ConfigurationOptionId` and use it in core contracts where configuration option keys are represented. |
| 2 | `backend-validationV2-impl-02-fable-type.md` | Add `fiab_core.types.FableType` and focused unit tests for `validate_convert`. |
| 3 | `backend-validationV2-impl-03-plugin-fable-type-migration.md` | Migrate plugin `value_type` declarations to the accepted `FableType` syntax. |
| 4 | `backend-validationV2-impl-04-backend-conversion.md` | Call `validate_convert` during backend validation and compilation, and migrate plugin code to consume converted values. |
| 5 | `backend-validationV2-impl-05-missing-values-validation.md` | Stop reporting missing configuration values as validation errors; keep compilation strict. |
| 6 | `backend-validationV2-impl-06-block-expansion-contract.md` | Change plugin expansion from factory ids to `BlockExpansion` values with restrictions. |
| 7 | `backend-validationV2-impl-07-test-plugin-restrictions.md` | Add a meaningful restriction-producing example in `fiab-plugin-test` and cover it with integration tests. |
| 8 | `backend-validationV2-impl-08-missing-glyph-warnings.md` | Report missing glyphs separately from hard validation errors and omit affected options during validation. |
| 99 | `backend-validationV2-impl-99-leftovers.md` | Track items intentionally left outside this staged implementation. |

## Cross-task constraints

- Keep each task independently mergeable to `main`.
- Do not require frontend code changes in any backend task, but record frontend-visible response/schema changes in `backend-validationV2-frontendImpact.md`.
- Do not rely on converted configuration values before task 4.
- Do not rely on missing configuration values being omitted before task 5.
- Do not rely on non-empty expansion restrictions before task 7.
- Preserve compilation as the strict path: missing values, unknown glyphs, malformed glyphs, and type conversion errors must block compilation.
- Preserve malformed glyph expressions as hard validation errors; only unknown glyph references become soft validation warnings in task 8.

## Concerns and doubts to resolve during review

### FableType syntax compatibility

The proposal mentions `enumClosed[...]` and `enumOpen[...]`, while current plugins use `enum[...]`, `date-iso8601`, `datetime`, `optional[int]`, and list syntax such as `list[int]`. The task breakdown assumes the implementation should choose and document one canonical syntax, with any compatibility aliases handled deliberately. If backward compatibility for existing catalogues is required during the migration window, that should be explicit.

### `optional[int]` is not in the proposed type system

`fiab-plugin-ecmwf` currently declares `optional[int]` for `ensemble_members`. The original spec says `None` should not be a normal acceptable value and does not list optional types. The migration task should decide whether this becomes an ordinary `int` with frontend/default behavior, a temporary compatibility alias, or a rejected type.

### Converted values conflict with current `BlockInstance` typing

`BlockInstance.configuration_values` is currently `dict[str, str]`. After task 4 the backend will pass parsed values such as `int`, `float`, `date`, `datetime`, and lists to plugins. This likely requires widening the internal type, creating an internal converted block model, or using a separate converted configuration mapping. The task should avoid unsafe casts that hide the contract change.

### Validation vs create/update semantics

The current `/blueprint/create` and `/blueprint/update` routes call validation and reject any returned `block_errors`. Task 5 makes missing configuration values non-errors during validation. That means incomplete blueprints may become saveable through these existing routes unless another strict path is added. This appears aligned with the `prevalidate` user story, but it is a behavior change and should be reviewed explicitly.

### Expand restriction shape at the HTTP boundary

The core plugin method can return local `BlockExpansion` values with local `BlockFactoryId`, but `/blueprint/expand` currently returns `PluginBlockFactoryId` values so the frontend can identify the owning plugin. Task 6 needs a route-level serialized shape that keeps plugin identity and adds restrictions without making the response ambiguous.


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

## Review decisions folded into task specs

- Canonical catalogue migration starts with `enum[...]` to `enumClosed[...]`, `date-iso8601` to `date`, `optional[int]` to `int`, and keeps `list[int]` valid.
- Catalogue-level backward compatibility is not required; the task 3 worker must document final catalogue changes in `backend-validationV2-frontendImpact.md`.
- `BlockInstance.configuration_values` should be widened to `dict[str, Any]`; `validate_convert` should accept `Any`, check that input is a string, and raise `TypeError` otherwise.
- Saving incomplete blueprints after task 5 is accepted behavior for this work. A future blueprint metadata flag for "ready for compilation" is tracked in leftovers.
- Core `BlockExpansion` contains a local `BlockFactoryId`; `domain.blueprint.service` must convert that to a route/domain response shape containing `PluginBlockFactoryId`, matching the existing expansion aggregation pattern.

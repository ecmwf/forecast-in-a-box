# Task 8: Treat missing glyphs as validation warnings

## Goal

Unknown glyph references should not make validation fail. During validation, any configuration option that depends on a missing glyph should be omitted before plugin validation, and the missing glyph names should be reported separately.

During compilation, unknown glyphs remain a hard failure.

## Expected scope

- Extend `BlueprintValidationExpansion` and the `/blueprint/expand` response with:

```python
missing_glyphs: dict[BlockInstanceId, dict[ConfigurationOptionId, list[str]]]
```

- Detect unknown glyph references before and after glyph substitution, preserving existing handling for nested glyph references.
- For validation, omit affected configuration options from the block passed to plugin validation.
- For validation, do not add `block_errors` solely for unknown glyph references.
- For compilation, keep unknown glyph references as hard failures before plugin compilation.
- Update integration tests to cover the new field and the non-error validation behavior.

## Constraints

- Malformed expressions remain hard validation errors.
- Circular glyph references remain hard validation errors unless a separate task changes that.
- Missing glyphs should be grouped by block instance id and configuration option id.
- The list of missing glyph names should be deterministic for test stability.
- Do not require frontend code changes.
- Do not make plugins responsible for detecting or reporting missing glyphs.

## Non-goals

- No frontend warning UI.
- No changes to valid glyph resolution semantics.
- No changes to compilation strictness.
- No changes to how missing configuration values are represented beyond relying on task 5 behavior.

## Frontend impact note

This task adds `missing_glyphs` to `PUT /blueprint/expand`. Update `backend-validationV2-frontendImpact.md` with the final response example and any exact field naming.


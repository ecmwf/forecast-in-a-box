# Task 7: Exercise ConfigurationOptionRestriction in fiab-plugin-test

## Goal

Use `fiab-plugin-test` to demonstrate and test non-empty `ConfigurationOptionRestriction` values returned from expansion.

This task should prove the backend can carry restrictions from plugin expanders to the `/blueprint/expand` response.

## Expected scope

- Modify an existing `fiab-plugin-test` block factory or add a small new one that can produce a meaningful restriction based on the input output type/metadata.
- Update the test plugin expander to return a `BlockExpansion` with at least one non-empty `configuration_option_restrictions` entry.
- Extend an existing integration test in `backend/tests/integration/test_blueprint.py` to assert the restriction appears in `possible_expansions`.
- Keep the example simple and deterministic.

## Constraints

- Prefer a small test-plugin-only scenario over changing production ECMWF behavior.
- The restriction should be represented as a `FableType` that is already valid according to task 2.
- The test should verify the route response, not just the plugin function.
- Avoid adding a large new fixture or unrelated test plugin behavior.

## Non-goals

- Do not require frontend code changes.
- Do not migrate ECMWF plugins to produce meaningful restrictions.
- Do not implement frontend enforcement or completion.
- Do not add a general restriction solver beyond carrying the plugin-provided mapping.

## Frontend impact note

This task makes non-empty restrictions visible in `PUT /blueprint/expand`. Update `backend-validationV2-frontendImpact.md` with the concrete response example used by the integration test.


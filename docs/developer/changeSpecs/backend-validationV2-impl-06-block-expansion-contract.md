# Task 6: Change expand contract to BlockExpansion

## Goal

Change plugin expansion from returning only block factory ids to returning `BlockExpansion` objects that include both the block factory and configuration option restrictions.

In this task, plugins should return empty restrictions only. Non-empty restrictions are introduced in task 7.

## Expected scope

- Add core types for:
  - `ConfigurationOptionRestriction`, a mapping from `ConfigurationOptionId` to `FableType`
  - `BlockExpansion`, containing a `BlockFactoryId` and a `ConfigurationOptionRestriction`
- Update the `Plugin` contract and helper builders so expanders return `list[BlockExpansion]`.
- Update backend aggregation in `validate_expand` so `/blueprint/expand` can still identify the plugin for each expansion. The core `BlockExpansion` contains a local `BlockFactoryId`; the service-level route response shape must contain a `PluginBlockFactoryId`.
- Update `fiab-plugin-test` and `fiab-plugin-ecmwf` expanders with minimally viable `BlockExpansion(..., restrictions={})` values.
- Update tests that assert `possible_expansions` response shape.

## Constraints

- Keep plugin changes minimal. Do not design meaningful restrictions in this task.
- Preserve possible source behavior unless the implementation intentionally decides source expansions also need the same shape.
- Preserve `NoOutput` behavior: blocks with no expandable output should still produce no expansions.
- The route-level response must not lose plugin identity. Replicate the existing expand aggregation pattern: plugin expanders return local ids, and `domain.blueprint.service` casts/combines them with the plugin id into `PluginBlockFactoryId` values for the backend route response.
- Keep response additions additive where possible, but the list element shape will necessarily change.

## Non-goals

- No non-empty restrictions.
- No frontend code changes.
- No expand-left support.
- No heuristic improvements to plugin `intersect` methods.

## Frontend impact note

This task changes `PUT /blueprint/expand` response shape. Update `backend-validationV2-frontendImpact.md` with the final serialized field names and examples.

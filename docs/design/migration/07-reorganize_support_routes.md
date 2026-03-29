# 07 - reorganize support routes

Likely files and directories to read and modify first:

- `backend/src/forecastbox/api/routers/artifacts.py`
- `backend/src/forecastbox/api/artifacts/`
- `backend/src/forecastbox/api/routers/plugin.py`
- `backend/src/forecastbox/api/plugin/`
- `backend/src/forecastbox/api/routers/admin.py`
- `backend/src/forecastbox/api/routers/auth.py`
- `backend/src/forecastbox/api/routers/gateway.py`
- `backend/src/forecastbox/entrypoint.py`
- `backend/tests/integration/test_model.py`
- `backend/tests/integration/test_admin_flows.py`

## Objective

Move the non-entity HTTP surface into canonical top-level route modules:

- `routes.artifacts`
- `routes.plugins`
- `routes.admin`
- `routes.auth`
- `routes.gateway`
- `routes.status`

This is also the point where the old `api/routers/` and `api/types/` layout should stop being the live source of truth.

## Required outcome

- the support-route modules above exist under `forecastbox.routes`,
- the old route layout is removed from active use,
- admin routes are allowed to keep path parameters for now,
- artifacts/plugins/admin/auth/gateway/status tests are updated and still pass.

## Concrete changes

1. Create canonical top-level support route modules.

2. Move or inline route-local contracts as appropriate.

Unlike the entity routes, these modules may not need large new contract surfaces, but they should still stop depending on the old `api/types/` layout as an architectural default.

Where support routes still need RJSF helpers, they should import them from `forecastbox.utility.rsjf`.

3. Remove old support router ownership.

Once the new route modules are active, the old `api/routers/*.py` support modules should be deleted or reduced to short-lived internal shims only if absolutely necessary for finishing the sequence.

4. Keep the admin path-parameter exception.

Do not spend time forcing admin routes away from path parameters in this migration.

## Behavior constraints

- Preserve plugin install/update/uninstall behavior.
- Preserve artifact list/detail/download/delete behavior.
- Preserve auth behavior.
- Preserve gateway lifecycle behavior.
- Preserve admin behavior apart from any route/module renames needed to fit the canonical structure.
- Do not restore the deleted `models` or `products` packages.

## Validation

- Pay special attention to:
  - `backend/tests/integration/test_model.py`
  - `backend/tests/integration/test_admin_flows.py`
- Then run `cd backend && just val`.

## Handoff notes for the next step

This step is successful when the backend’s live HTTP surface is fully owned by `forecastbox.routes`, with only the final entrypoint discovery switch still outstanding.

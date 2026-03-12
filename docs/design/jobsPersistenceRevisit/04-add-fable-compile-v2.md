# Goal
Compile a persisted `JobDefinition` through a new v2 endpoint instead of compiling only an inline builder payload.

## Scope
- Add `PUT /api/v1/fable/compile_v2`.
- Accept a `JobDefinition` reference (`id`, optional `version` defaulting to latest).
- Load the saved builder payload from jobs2 storage and compile it with the existing `forecastbox.api.fable.compile()` machinery.
- Keep the response shape compatible with current `ExecutionSpecification` so downstream code can reuse it.
- Do not remove or alter `/fable/compile`.

## Main files
- `backend/src/forecastbox/api/routers/fable.py`
- request/response models in `backend/src/forecastbox/api/types/`
- jobs2 retrieval helpers

## Validation
- A builder saved via `save_v2` can be compiled by reference via `compile_v2`.
- Omitting `version` resolves to the latest saved version.
- The returned `ExecutionSpecification` is usable by the later v2 execution work.
- `cd backend && uv run ty check`
- `cd backend && uv run pytest tests/integration -k fable_v2_compile`
- If baseline noise is resolved on the branch, also run `cd backend && just val`.

## Non-goals
- No execution submission yet
- No template/catalogue filtering work

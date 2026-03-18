# Goal
Migrate frontend fable persistence from v1 save/load endpoints to the available v2 save/load/compile endpoints, while explicitly keeping catalogue and validation on v1.

## Scope
- Add frontend support for:
  - `POST /api/v1/fable/upsert_v2`
  - `GET /api/v1/fable/retrieve_v2`
  - `PUT /api/v1/fable/compile_v2`
- Replace v1 save/load usage in the frontend.
- Preserve existing use of:
  - `GET /api/v1/fable/catalogue`
  - `PUT /api/v1/fable/expand`

## Backend facts to preserve
- `upsert_v2` accepts a JSON body:
  - `builder`
  - `display_name`
  - `display_description`
  - `tags`
  - `parent_id`
- `upsert_v2` returns `{ id, version }`.
- `retrieve_v2` returns builder plus metadata, not just the builder.
- `compile_v2` compiles by persisted definition reference `{ id, version? }`, not by inline builder body.

## Current frontend usage
- Endpoint registry: `frontend/src/api/endpoints.ts`
- Fable wrappers: `frontend/src/api/endpoints/fable.ts`
- Hooks: `frontend/src/api/hooks/useFable.ts`
- Save UI: `frontend/src/features/fable-builder/components/SaveConfigPopover.tsx`
- Submit flow dependency: `frontend/src/api/hooks/useJobs.ts` currently imports `compileFable`
- Mock handlers: `frontend/mocks/handlers/fable.handlers.ts`
- Tests:
  - `frontend/tests/unit/api/endpoints/fable.test.ts`
  - `frontend/tests/unit/api/hooks/useFable.test.tsx`
  - `frontend/tests/integration/features/fable-builder/save-and-load.test.tsx`

## Observed current behavior
- Save currently calls v1 `upsert` and only persists the builder.
- `SaveConfigPopover` collects `title`, `comments`, and `tags`, but only stores them in local storage metadata. The backend never receives them.
- Load currently expects `retrieve()` to return only `FableBuilderV1`.
- `useSubmitFable()` still compiles an inline builder via v1 `compile`.

## Required changes
1. Extend the frontend endpoint registry.
   - Add v2 fable routes to `frontend/src/api/endpoints.ts`.
   - Keep existing v1 routes because `catalogue` and `expand` stay on v1.

2. Add explicit TypeScript models for the v2 contract.
   - Add request/response types in `frontend/src/api/types/fable.types.ts` for:
     - save request/response
     - retrieve response
     - compile-by-reference request
   - Do not weaken typing to `unknown`/`any`; keep the metadata fields typed.

3. Update the fable endpoint wrappers.
   - Add v2 save/load/compile wrappers in `frontend/src/api/endpoints/fable.ts`.
   - Keep `getCatalogue()` and `expandFable()` unchanged.
   - Prefer new wrapper names that make the version explicit at the endpoint layer if that helps keep the hooks readable.

4. Migrate the hooks to v2 save/load behavior.
   - `useFable()` should load `retrieve_v2`, then return the `builder` field to existing builder consumers.
   - Decide whether to expose the metadata separately from the hook or to keep `useFable()` builder-only and add a second metadata-aware hook. Either is acceptable, but choose one approach and use it consistently.
   - `useUpsertFable()` should send:
     - `display_name` from the Save UI title
     - `display_description` from the Save UI comments
     - `tags` from the Save UI tags
     - `builder` from the store
   - Preserve update-vs-save-as-new behavior by passing or omitting the existing `id`.

5. Update `SaveConfigPopover.tsx`.
   - Stop treating title/comments/tags as local-only metadata.
   - Continue writing the local metadata store for quick UI display, but make the backend the source of truth for persisted metadata.
   - If a saved config is re-opened later, the UI should be able to rehydrate from backend metadata rather than only local storage.

6. Prepare the compile-by-reference bridge for the job stage.
   - Add a `compileFableV2()` helper that accepts `{ id, version? }`.
   - Do not switch the submit dialog to it in this stage unless doing so keeps the stage self-contained and does not force the job stage to rework the same code again.

## Recommended implementation order
1. Add endpoint constants and TS types.
2. Update `frontend/src/api/endpoints/fable.ts`.
3. Update `useFable.ts`.
4. Update `SaveConfigPopover.tsx`.
5. Update MSW handlers.
6. Update tests.

## Validation
- Unit:
  - `cd frontend && npm run test:unit -- tests/unit/api/endpoints/fable.test.ts`
  - `cd frontend && npm run test:unit -- tests/unit/api/hooks/useFable.test.tsx`
- Integration:
  - `cd frontend && npm run test:integration -- tests/integration/features/fable-builder/save-and-load.test.tsx`
- Manual/code checks:
  - Save existing config -> update same logical id, new version returned
  - Save as new -> new id returned
  - Load saved config -> builder reconstructs correctly
  - Title/comments/tags round-trip through the backend

## Non-goals
- Do not migrate `catalogue` or `expand`; there is no v2 route for them.
- Do not migrate job list/detail pages here.
- Do not invent a schedule frontend surface.

## Handoff note for the next stage
The job stage should assume that this stage can provide a persisted fable/job-definition reference and, ideally, a `compileFableV2()` helper if compile-by-reference is still needed.


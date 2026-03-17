# Goal
Plan the execution-detail migration separately from the execution-list migration because the current frontend detail page depends on several job routes that still do not have v2 equivalents.

## Scope
- Migrate what is feasible today on the execution detail route:
  - `GET /api/v1/job/{job_id}/status -> GET /api/v1/job/{execution_id}/status_v2`
  - `POST /api/v1/job/{job_id}/restart -> POST /api/v1/job/{execution_id}/restart_v2`
- Explicitly document the current blockers for:
  - result download
  - log download
  - delete
  - output availability

## Backend facts to preserve
- `status_v2` and `restart_v2` exist.
- `outputs_v2` exists.
- `specification_v2` exists, but the current `SpecificationPanel` already renders from `fableSnapshot` metadata and does not need a remote spec fetch to keep working.
- There is currently no backend v2 route for:
  - results download
  - logs download
  - delete
  - available output ids

## Current frontend usage
- Main route:
  - `frontend/src/features/executions/components/ExecutionDetailPage.tsx`
- Supporting components:
  - `frontend/src/features/executions/components/OutputsPanel.tsx`
  - `frontend/src/features/executions/components/OutputCard.tsx`
  - `frontend/src/features/executions/components/LogsPanel.tsx`
  - `frontend/src/features/executions/components/ExecutionErrorBanner.tsx`
  - `frontend/src/features/executions/components/SpecificationPanel.tsx`
- Hooks and wrappers:
  - `frontend/src/api/hooks/useJobs.ts`
  - `frontend/src/api/endpoints/job.ts`
- Local metadata:
  - `frontend/src/features/executions/stores/useJobMetadataStore.ts`
- Tests likely affected:
  - `frontend/tests/integration/features/executions/job-detail.test.tsx`
  - `frontend/tests/e2e/executions.spec.ts`

## Critical semantic change
The current restart flow is incompatible with v2.

Current v1 assumption:
- restart returns a brand-new top-level id
- UI stores metadata under that new id
- route navigates to `/executions/{newId}`

Actual v2 behavior:
- restart returns the same logical `execution_id`
- only `attempt_count` changes
- the correct post-restart behavior is to stay on the same logical execution route and refetch the latest attempt

## Required changes for the feasible part
1. Update detail status polling to v2.
   - `useJobStatus()` should consume `status_v2`.
   - Treat the route parameter as an execution id even if the filename/path segment still says `$jobId`.
   - If a rename to `$executionId` is easy and isolated, it is acceptable, but prefer minimal churn.

2. Update restart handling to v2 semantics.
   - `useRestartJob()` should call `restart_v2`.
   - `ExecutionDetailPage.tsx` should not create a new metadata entry keyed by a new id.
   - On success:
     - keep the same route
     - invalidate/refetch status data
     - if useful, surface the new `attempt_count` in the UI or logs

3. Decide how much of the detail page can move now.
   - `SpecificationPanel` can continue to use local `fableSnapshot`.
   - The status header can move to v2.
   - Restart can move to v2.

## Current blockers
1. Result download
   - `OutputCard.tsx` calls `getJobResult(jobId, taskId)`.
   - There is no `results_v2` route.
   - `OutputCard` cannot be pointed at an execution id and still work.

2. Log download
   - `LogsPanel.tsx` and `ExecutionErrorBanner.tsx` call `downloadJobLogs(jobId)`.
   - There is no `logs_v2` route.

3. Delete
   - `ExecutionDetailPage.tsx` calls `useDeleteJob()`.
   - There is no `delete_v2` route.

4. Output availability
   - `OutputsPanel.tsx` calls both `useJobAvailable()` and `useJobOutputs()`.
   - There is no `available_v2` route.
   - Although `outputs_v2` exists, the current UI still depends on result download and therefore cannot fully migrate.

## Recommended strategy
Choose one of these explicitly and document the choice in code review notes:

### Option A: partial v2 detail migration
- Migrate status and restart to v2 now.
- Leave artifact actions disabled or hidden on v2-backed detail pages.
- Clearly mark delete/log/result download as temporarily unavailable until backend support exists.

### Option B: hold the detail page on v1
- Do not switch the detail route to v2 until backend adds:
  - results download
  - log download
  - delete
- This avoids a mixed-id page, but delays the user-visible v2 rollout.

Recommended option: **A**, because list/submission can still move forward and the missing capabilities are already isolated to the detail page.

## Validation
- Integration:
  - `cd frontend && npm run test:integration -- tests/integration/features/executions/job-detail.test.tsx`
- E2E/smoke:
  - `cd frontend && npm run test:e2e -- executions.spec.ts`
- Manual/code checks:
  - Opening an execution detail page fetches by `execution_id`
  - Restart keeps the same route id and refreshes status
  - No remaining code path sends an execution id to a v1 route that expects a v1 job id
  - If artifact actions stay visible, verify they are intentionally still backed by a valid route; otherwise hide/disable them

## Stop condition for a standalone agent
If the implementation would require a v2 result/log/delete route that does not yet exist, stop and record the blocker in `10-migrationProgress.md` rather than inventing a client-side workaround.


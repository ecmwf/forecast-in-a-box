# Frontend migration progress

This file tracks implementation progress for the frontend migration from v1 to v2 endpoint usage. It does **not** track the drafting of the planning documents themselves.

## Status legend
- `pending`
- `in_progress`
- `blocked`
- `done`

## Stages

### 11-fableEndpoints.md
- Status: `done`
- Owner:
- Main files:
  - `frontend/src/api/endpoints.ts`
  - `frontend/src/api/endpoints/fable.ts`
  - `frontend/src/api/hooks/useFable.ts`
  - `frontend/src/features/fable-builder/components/SaveConfigPopover.tsx`
  - `frontend/mocks/handlers/fable.handlers.ts`
- Validation:
  - `cd frontend && npm run test:unit -- tests/unit/api/endpoints/fable.test.ts`
  - `cd frontend && npm run test:unit -- tests/unit/api/hooks/useFable.test.tsx`
  - `cd frontend && npm run test:integration -- tests/integration/features/fable-builder/save-and-load.test.tsx`
- Notes: v2 wrappers (`retrieveFableV2`, `upsertFableV2`, `compileFableV2`) added to `endpoints/fable.ts`; `useFable` now calls `retrieveV2` internally (still returns `FableBuilderV1`); `useUpsertFable` now requires `display_name`/`display_description` and returns `{ id, version }`; `SaveConfigPopover` passes title and comments to the backend; `useCompileFableV2` hook added for compile-by-reference use in next stage.

### 12-jobSubmissionAndList.md
- Status: `done`
- Owner:
- Depends on:
  - `11-fableEndpoints.md`
- Main files:
  - `frontend/src/api/endpoints.ts`
  - `frontend/src/api/endpoints/job.ts`
  - `frontend/src/api/hooks/useJobs.ts`
  - `frontend/src/api/hooks/useJobStatusCounts.ts`
  - `frontend/src/features/executions/components/SubmitJobDialog.tsx`
  - `frontend/src/features/executions/components/JobListPage.tsx`
  - `frontend/src/features/dashboard/components/WelcomeCard.tsx`
  - `frontend/src/features/dashboard/components/JobStatusDetailsPopover.tsx`
  - `frontend/src/features/executions/stores/useJobMetadataStore.ts`
  - `frontend/mocks/handlers/job.handlers.ts`
- Validation:
  - `cd frontend && npm run test:unit -- tests/unit/api/hooks/useJobStatusCounts.test.tsx`
  - `cd frontend && npm run test:integration -- tests/integration/features/dashboard/job-status-popover.test.tsx`
  - `cd frontend && npm run test:integration -- tests/integration/features/executions/job-list.test.tsx`
- Notes: `useSubmitFable` now calls `upsertFableV2` then `executeJobV2` (keying metadata by `execution_id`); `useJobsStatus` and `useJobStatusCounts` now consume `status_v2` (`executions[]` array); `JobListPage` normalises the array into a map before rendering; v1 handlers kept for detail-page tests; environment spec field in submit dialog retained in UI but not forwarded (not supported by execute_v2).

### 13-jobDetailAndArtifacts.md
- Status: `done`
- Owner:
- Depends on:
  - `12-jobSubmissionAndList.md`
- Main files:
  - `frontend/src/features/executions/components/ExecutionDetailPage.tsx`
  - `frontend/src/features/executions/components/OutputsPanel.tsx`
  - `frontend/src/features/executions/components/OutputCard.tsx`
  - `frontend/src/features/executions/components/LogsPanel.tsx`
  - `frontend/src/features/executions/components/ExecutionErrorBanner.tsx`
  - `frontend/src/api/endpoints/job.ts`
  - `frontend/src/api/hooks/useJobs.ts`
- Validation:
  - `cd frontend && npm run test:integration -- tests/integration/features/executions/job-detail.test.tsx`
  - `cd frontend && npm run test:e2e -- executions.spec.ts`
- Known blocker:
  - Backend currently has no v2 routes for result download, log download, or delete.
- Notes: All detail-page routes fully migrated to v2: `useJobStatus` → `status_v2`, `useJobOutputs` → `outputs_v2`, `useJobAvailable` → `available_v2`, `getJobResultV2`/`downloadJobLogsV2` for artifact download, `restartJobV2` (stays on same route, invalidates status), `deleteJobV2` (query-param DELETE); v2 mock handlers added for all; restart no longer navigates to a new id.

### 14-scheduleEndpoints.md
- Status: `pending`
- Owner:
- Main files:
  - `frontend/src/api/endpoints.ts`
  - `frontend/src/api/endpoints/`
  - `frontend/src/api/hooks/`
  - `frontend/mocks/handlers/`
- Validation:
  - `rg "API_ENDPOINTS\\.schedule|/api/v1/schedule/" frontend/src frontend/tests`
  - `rg "schedule" frontend/src frontend/tests`
- Notes:


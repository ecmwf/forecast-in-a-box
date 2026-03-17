# Goal
Migrate the frontend submission flow and execution list/count views to the v2 job APIs that already exist, while leaving execution-detail artifact handling to a separate stage.

## Scope
- Migrate submission from:
  - `POST /api/v1/job/execute`
  to:
  - `POST /api/v1/job/execute_v2`
- Migrate list/count views from:
  - `GET /api/v1/job/status`
  to:
  - `GET /api/v1/job/status_v2`
- Keep detail-page artifact work out of this stage.

## Backend facts to preserve
- `execute_v2` accepts `{ job_definition_id, job_definition_version? }`.
- `execute_v2` returns `{ execution_id, attempt_count }`.
- `status_v2` returns a paginated `executions: JobExecutionDetail[]` array, not a `progresses` map.
- The canonical identifier becomes `execution_id`.

## Current frontend usage
- Endpoint registry: `frontend/src/api/endpoints.ts`
- Job wrappers: `frontend/src/api/endpoints/job.ts`
- Hooks:
  - `frontend/src/api/hooks/useJobs.ts`
  - `frontend/src/api/hooks/useJobStatusCounts.ts`
- Submit UI: `frontend/src/features/executions/components/SubmitJobDialog.tsx`
- List UI and dashboard widgets:
  - `frontend/src/features/executions/components/JobListPage.tsx`
  - `frontend/src/features/dashboard/components/WelcomeCard.tsx`
  - `frontend/src/features/dashboard/components/JobStatusDetailsPopover.tsx`
- Local metadata store:
  - `frontend/src/features/executions/stores/useJobMetadataStore.ts`
- Mock handlers:
  - `frontend/mocks/handlers/job.handlers.ts`
  - `frontend/mocks/handlers/fable.handlers.ts`
- Tests most likely to move:
  - `frontend/tests/unit/api/hooks/useJobStatusCounts.test.tsx`
  - `frontend/tests/integration/features/dashboard/job-status-popover.test.tsx`
  - `frontend/tests/integration/features/executions/job-list.test.tsx`
  - `frontend/tests/e2e/executions.spec.ts`

## Dependency on the fable stage
This stage depends on `11-fableEndpoints.md`.

The current submit path in `useSubmitFable()` does:
1. inline `compileFable(fable)`
2. inline `executeJob(spec)`

That is not compatible with v2. The v2-compatible flow is:
1. ensure a persisted definition exists
2. call `execute_v2(job_definition_id, version?)`

For unnamed or one-off submissions, create a v2 save first and let the backend classify it as `oneoff_execution`.

## Required changes
1. Add job v2 endpoint constants and TS types.
   - Add `execute_v2` and `status_v2` endpoint entries.
   - Add TS models for:
     - `JobExecuteV2Request`
     - `JobExecuteV2Response`
     - `JobExecutionDetail`
     - `JobExecutionListV2`

2. Update the submit flow in `useJobs.ts`.
   - Replace the inline v1 `executeJob(spec)` path with:
     - save-or-resolve persisted definition id/version
     - `execute_v2`
   - Store metadata in `useJobMetadataStore` keyed by `execution_id`, not v1 job id.
   - Keep the UI-facing behavior the same: after submit, navigate to the executions area using the returned logical id.

3. Update the metadata store semantics.
   - The store interface can stay `jobs` for now if renaming would create too much churn, but the keys should now be execution ids.
   - Document that this is an execution metadata store even if the filename remains `useJobMetadataStore.ts`.

4. Update list/count consumers to the v2 response shape.
   - `useJobsStatus()` should consume `status_v2`.
   - `useJobStatusCounts()` should count from `executions[]`, not from `progresses{}`.
   - `JobListPage.tsx` should either:
     - normalize `executions[]` into a local map before rendering, or
     - render directly from the array.
   - Prefer a single normalization strategy in the endpoint/hook layer so components do not each invent their own adapter.

5. Update the mock layer.
   - Add v2 MSW handlers for submission and list/status.
   - Keep the old v1 handlers only where other tests still require them.

6. Update tests.
   - Rewrite job-count and list assertions around `execution_id`.
   - Update any mocked response shape assumptions from `progresses` to `executions`.

## Recommended implementation order
1. Add types and endpoint constants.
2. Update the submit flow and metadata store usage.
3. Update list hooks and dashboard counts.
4. Update the list page.
5. Update MSW handlers.
6. Update tests.

## Validation
- Unit:
  - `cd frontend && npm run test:unit -- tests/unit/api/hooks/useJobStatusCounts.test.tsx`
- Integration:
  - `cd frontend && npm run test:integration -- tests/integration/features/dashboard/job-status-popover.test.tsx`
  - `cd frontend && npm run test:integration -- tests/integration/features/executions/job-list.test.tsx`
- E2E/smoke:
  - `cd frontend && npm run test:e2e -- executions.spec.ts`
- Manual/code checks:
  - Submit from the dialog produces an `execution_id`
  - Submitted execution appears in the list
  - Dashboard counts still match the list contents

## Non-goals
- Do not migrate result download, log download, delete, or detail-page artifact rendering here.
- Do not attempt schedule work here.

## Handoff note for the next stage
After this stage, the list and submit surfaces should speak in `execution_id`s. The detail stage must reuse that identity and must not reintroduce v1 job-id assumptions.


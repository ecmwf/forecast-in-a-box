# Goal
Document the frontend migration target from v1 endpoints to the v2 endpoints that already exist in the backend, based on the current router code.

## Endpoint migrations
- `/api/v1/fable/upsert -> /api/v1/fable/upsert_v2`: request changes from `{"builder": FableBuilderV1}` plus query params (`fable_builder_id`, `tags`) to a structured JSON body with `builder`, `display_name`, `display_description`, `tags`, and `parent_id`; response changes from a bare string id to `{ id, version }`; saves become versioned job definitions rather than mutable builder rows.
- `/api/v1/fable/retrieve -> /api/v1/fable/retrieve_v2`: query param changes from `fable_builder_id` to `fable_id` plus optional `version`; response changes from bare `FableBuilderV1` to `{ id, version, builder, display_name, display_description, tags, parent_id }`.
- `/api/v1/fable/compile -> /api/v1/fable/compile_v2`: request changes from an inline `FableBuilderV1` body to `{ id, version? }`; semantics change from compiling an unsaved builder to compiling a persisted definition by reference.
- `/api/v1/job/execute -> /api/v1/job/execute_v2`: request changes from raw `ExecutionSpecification` to `{ job_definition_id, job_definition_version? }`; response changes from `{ id }` to `{ execution_id, attempt_count }`; semantics change from running an inline spec to running a persisted job definition.
- `/api/v1/job/status -> /api/v1/job/status_v2`: response changes from `{ progresses: Record<jobId, JobProgressResponse>, ... }` to `{ executions: JobExecutionDetail[], ... }`; list items are keyed by logical `execution_id`, not v1 job ids, and represent the latest attempt.
- `/api/v1/job/{job_id}/status -> /api/v1/job/{execution_id}/status_v2`: path identifier changes from a v1 job id to a logical execution id; optional `attempt_count` query param is introduced; response now includes execution metadata such as `job_definition_id`, `job_definition_version`, and `cascade_job_id`.
- `/api/v1/job/{job_id}/outputs -> /api/v1/job/{execution_id}/outputs_v2`: path identifier changes from job id to execution id; optional `attempt_count` query param is introduced; semantics stay close to v1 in that the response is still `list[ProductToOutputId]`, but it is now sourced from the execution row.
- `/api/v1/job/{job_id}/specification -> /api/v1/job/{execution_id}/specification_v2`: path identifier changes from job id to execution id; optional `attempt_count` query param is introduced; response changes from full `ExecutionSpecification` to `{ definition_id, definition_version, blocks, environment_spec }`.
- `/api/v1/job/{job_id}/restart -> /api/v1/job/{execution_id}/restart_v2`: path identifier changes from job id to execution id; response changes from a fresh v1 job id to `{ execution_id, attempt_count }`; semantics change from creating a new top-level job id to creating another attempt under the same logical execution id.
- `/api/v1/schedule/ -> /api/v1/schedule/list_v2`: route changes from path-root listing to explicit `/list_v2`; response changes from a dictionary keyed by `schedule_id` to an array of `ScheduleDefinitionV2Response`; semantics change from schedule records to versioned experiment definitions.
- `/api/v1/schedule/create -> /api/v1/schedule/create_v2`: request changes from embedded `exec_spec` to `job_definition_id` plus optional `job_definition_version`; v2 also adds `display_name`, `display_description`, and `tags`; response changes from `{ schedule_id }` to `{ experiment_id }`.
- `/api/v1/schedule/{schedule_id} [GET] -> /api/v1/schedule/get_v2`: path parameter becomes query parameter `experiment_id`; response changes from `GetScheduleResponse` with serialized `exec_spec`/`dynamic_expr` strings to `ScheduleDefinitionV2Response` with typed fields and version metadata.
- `/api/v1/schedule/{schedule_id} [POST] -> /api/v1/schedule/update_v2`: path parameter becomes query parameter `experiment_id`; request body loses `exec_spec`; v2 updates only schedule metadata (`cron_expr`, `enabled`, `dynamic_expr`, `max_acceptable_delay_hours`) on top of the referenced job definition.
- `/api/v1/schedule/{schedule_id}/next_run -> /api/v1/schedule/next_run_v2`: path identifier becomes query parameter `experiment_id`; semantics stay similar, but the backing row is now `ExperimentNext`.
- `/api/v1/schedule/{schedule_id}/runs -> /api/v1/schedule/runs_v2`: path identifier becomes query parameter `experiment_id`; response changes from a dictionary of schedule-run rows keyed by `schedule_run_id` to a paginated array of `{ execution_id, attempt_count, status, created_at, updated_at, trigger, scheduled_at }`.

## Important non-migrations
These v1 routes are still used by the frontend today but do not currently have v2 counterparts in the backend:

- Fable: `/api/v1/fable/catalogue`, `/api/v1/fable/expand`
- Job: `/api/v1/job/{job_id}/available`, `/api/v1/job/{job_id}/results`, `/api/v1/job/{job_id}/logs`, `/api/v1/job/{job_id}` (delete), `/api/v1/job/upload`, `/api/v1/job/flush`
- Schedule: `/api/v1/schedule/run/{schedule_run_id}`, `/api/v1/schedule/restart`

## Consequences for the frontend plan
- Fable save/load can migrate fully to v2.
- Fable validation/catalogue stay on v1 for now because no v2 route exists.
- Job submission and list/status views can migrate to v2.
- Job detail pages cannot be fully migrated yet because result download, log download, and delete still lack v2 routes.
- Schedule migration is currently planning-only because no frontend schedule API consumers were found.


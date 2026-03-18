There have been recent changes to the backend apis, notably `_v2` of certain endpoints were introduced.
Identify where the following endpoints are used in the frontend code, and replace them with the `_v2` invocations.
Note that the path identifier / query parameters change somehow

- `/api/v1/job/{job_id}/available` -> `/api/v1/job/{execution_id}/available_v2`: path identifier changes from job id to execution id; optional `attempt_count` query param is introduced
- `/api/v1/job/{job_id}/results` -> `/api/v1/job/{execution_id}/results_v2`: path identifier changes from job id to execution id; optional `attempt_count` query param is introduced
- `/api/v1/job/{job_id}/logs` -> `/api/v1/job/{execution_id}/logs_v2`: path identifier changes from job id to execution id; optional `attempt_count` query param is introduced
- `/api/v1/job/{job_id}` (delete) -> `/api/v1/job/delete_v2` (delete): path identifier vanishes, instead execution id and optional `attempt_count` are introduced as query params. No return value as opposed to deleted job count

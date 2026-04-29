# Frontend Migration: Run Outputs Refactor

This document describes the backend API changes introduced by the RunOutputs refactor,
so that the frontend can be updated accordingly.

## Summary

Run outputs are no longer a separate query. The `GET /api/v1/run/get` endpoint now
includes full output metadata (including per-output availability) directly in its
response. The dedicated `GET /api/v1/run/outputAvailability` endpoint has been
removed.

---

## Removed Endpoint

### `GET /api/v1/run/outputAvailability`

This endpoint no longer exists. Remove all calls to it. Its functionality is now
provided by the `outputs` field in `GET /api/v1/run/get` (see below).

---

## Changed Endpoint: `GET /api/v1/run/get`

### What changed

The response now includes an `outputs` field.

### New response shape

```json
{
  "run_id": "...",
  "attempt_count": 1,
  "status": "completed",
  "created_at": "...",
  "updated_at": "...",
  "blueprint_id": "...",
  "blueprint_version": 1,
  "error": null,
  "progress": "100.00",
  "cascade_job_id": "...",
  "outputs": {
    "outputs": {
      "<task_id_1>": {
        "mime_type": "image/png",
        "original_block": "my_sink_block",
        "is_available": true
      },
      "<task_id_2>": {
        "mime_type": "application/octet-stream",
        "original_block": "another_sink_block",
        "is_available": false
      }
    }
  }
}
```

The `outputs` field is `null` when the run has not yet been submitted to cascade
(i.e. no sink tasks have been identified yet). Once the job is submitted, `outputs`
is always an object.

### `outputs.outputs` object

Each key is a `task_id` string (the same ID previously returned by
`/run/outputAvailability` as list items, and still accepted by
`GET /api/v1/run/outputContent` as the `dataset_id` query parameter).

Each value has three fields:

| Field | Type | Description |
|---|---|---|
| `mime_type` | `string` | The MIME type of the output (e.g. `image/png`, `application/grib`, `text/plain`). |
| `original_block` | `string` | The block instance ID in the blueprint that produced this output. |
| `is_available` | `boolean` | Whether the output data is currently retrievable via `/run/outputContent`. |

### Migration pattern

Previously the frontend would:
1. Poll `GET /run/get` until status is `completed`.
2. Call `GET /run/outputAvailability` to get a list of available task IDs.
3. Call `GET /run/outputContent?dataset_id=<task_id>` for each one.

The new pattern:
1. Poll `GET /run/get` until status is `completed`.
2. Read `response.outputs.outputs` -- filter entries where `is_available === true`
   to get the task IDs.
3. Call `GET /run/outputContent?dataset_id=<task_id>` for each one.

The `mime_type` field can additionally be used to render outputs with the correct
content handler without needing to guess from the content itself.

---

## Unchanged Endpoint: `GET /api/v1/run/outputContent`

No changes. The `dataset_id` query parameter continues to accept the same task ID
strings that previously came from `/run/outputAvailability` and now come from the
keys of `outputs.outputs`.

---

## `GET /api/v1/run/list` (shape updated)

The list endpoint (`GET /api/v1/run/list`) returns `RunDetailResponse` objects with
the same `outputs` field as `GET /api/v1/run/get`. Availability is determined by the
same rules: `is_available` is `true` for all outputs of a completed run, `false` for
all outputs of a failed run, and reflects live cascade gateway state for runs that are
still in progress.

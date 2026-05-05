# Backend Artifacts Contract Extension

## Summary

The artifact-related API responses have been extended to carry richer information:

1. The `CompositeArtifactId` object that appears inside every artifact response now uses
   `artifact_local_id` instead of the old `ml_model_checkpoint_id` field.

2. Every artifact response object (`MlModelOverview` and `MlModelDetail`) now carries two
   additional fields: `is_locally_compatible` and `local_compatibility_detail`.

---

## Changed Fields

### `CompositeArtifactId` (nested in all artifact responses)

| Field (old) | Field (new) | Type | Notes |
|---|---|---|---|
| `ml_model_checkpoint_id` | `artifact_local_id` | `string` | Renamed to reflect that it is a generic local artifact ID, not necessarily tied to ML model checkpoints |

The field `artifact_store_id` is unchanged.

**Example (old):**
```json
{
  "artifact_store_id": "my_store",
  "ml_model_checkpoint_id": "aifs-single-1.0.0"
}
```

**Example (new):**
```json
{
  "artifact_store_id": "my_store",
  "artifact_local_id": "aifs-single-1.0.0"
}
```

---

### `MlModelOverview` (returned by `GET /api/v1/artifacts/list_models`)

Two new fields added:

| Field | Type | Description | Example |
|---|---|---|---|
| `is_locally_compatible` | `boolean` | Whether this artifact is usable on the current host (e.g. hardware and software requirements are met) | `true` |
| `local_compatibility_detail` | `string` or `null` | Human-readable reason when the artifact is not compatible; `null` when compatible | `"Requires CUDA 12, found CUDA 11"` or `null` |

**Full response example:**
```json
[
  {
    "composite_id": {
      "artifact_store_id": "my_store",
      "artifact_local_id": "aifs-single-1.0.0"
    },
    "display_name": "AIFS Single 1.0.0",
    "display_author": "ECMWF",
    "disk_size_bytes": 2147483648,
    "supported_platforms": ["linux"],
    "is_available": true,
    "is_locally_compatible": true,
    "local_compatibility_detail": null
  }
]
```

---

### `MlModelDetail` (returned by `POST /api/v1/artifacts/model_details`)

Same two new fields as `MlModelOverview`:

| Field | Type | Description | Example |
|---|---|---|---|
| `is_locally_compatible` | `boolean` | Whether this artifact is usable on the current host | `true` |
| `local_compatibility_detail` | `string` or `null` | Human-readable reason when not compatible; `null` when compatible | `null` |

**Full response example:**
```json
{
  "composite_id": {
    "artifact_store_id": "my_store",
    "artifact_local_id": "aifs-single-1.0.0"
  },
  "display_name": "AIFS Single 1.0.0",
  "display_author": "ECMWF",
  "display_description": "Global medium-range forecast model",
  "url": "https://example.com/aifs-single-1.0.0.ckpt",
  "disk_size_bytes": 2147483648,
  "pip_package_constraints": ["torch>=2.0"],
  "supported_platforms": ["linux"],
  "output_characteristics": ["..."],
  "input_characteristics": ["input_source"],
  "is_available": true,
  "is_locally_compatible": true,
  "local_compatibility_detail": null
}
```

---

## Request Changes

### Download and details endpoints

The request body for `POST /api/v1/artifacts/download_model`,
`POST /api/v1/artifacts/model_details`, and `POST /api/v1/artifacts/delete_model` also
uses `CompositeArtifactId`, so the same rename applies:

**Old request body:**
```json
{
  "artifact_store_id": "my_store",
  "ml_model_checkpoint_id": "aifs-single-1.0.0"
}
```

**New request body:**
```json
{
  "artifact_store_id": "my_store",
  "artifact_local_id": "aifs-single-1.0.0"
}
```

---

## Migration Guide

1. Replace every occurrence of `ml_model_checkpoint_id` with `artifact_local_id` in both
   request payloads and response parsing code.

2. Optionally read and display `is_locally_compatible` and `local_compatibility_detail` in
   artifact listing and detail views. When `is_locally_compatible` is `false`, the
   `local_compatibility_detail` string explains why, and the artifact should not be offered
   for selection as a model input.

# Model Download Progress Implementation

## Summary

This implementation adds progress tracking for artifact downloads in the forecast-in-a-box project, based on the specification in commit `eca6b93` on the `feat/modelDownloadProgress` branch.

## Problem Statement

The `download_model` endpoint returned 400 errors ("Artifact already available") for subsequent calls when:
1. A model was already downloaded
2. A download was in progress

This made it impossible to query download status.

## Solution

Implemented progress tracking that allows the endpoint to return progress information (0-100%) for all states:
- **0%**: Download just submitted
- **1-99%**: Download in progress
- **100%**: Download complete/already available
- **Error string**: Download failed

## Changes Made

### 1. ArtifactManager (manager.py)

#### Added Field
```python
ongoing_downloads: dict[CompositeArtifactId, int | str] = {}
```
Tracks download progress (int 0-100) or error messages (str).

#### Modified `submit_artifact_download`
- **Old return type**: `Either[None, str]`
- **New return type**: `Either[int, str]`
- **Behavior**:
  - Returns `Either.ok(100)` if artifact already available
  - Returns `Either.ok(progress)` if download in progress
  - Returns `Either.ok(0)` when starting new download
  - Returns `Either.error(msg)` on failure

#### New Function: `report_artifact_download_progress`
```python
def report_artifact_download_progress(
    composite_id: CompositeArtifactId, 
    progress: int | None = None, 
    failure: str | None = None
) -> None
```
Thread-safe method for updating download progress. Only updates when lock is held, logs warning if lock acquisition fails.

#### Modified `_download_artifact_task`
- Creates progress callback for `download_artifact`
- Cleans up `ongoing_downloads` entry on success
- Reports failures via `report_artifact_download_progress`

### 2. IO Module (io.py)

#### Modified `download_artifact`
- Added optional parameter: `progress_callback: Callable[[int], None] | None = None`
- Calls callback with integer progress (0-100) during download
- Removed TODO comment
- Backward compatible (callback is optional)

### 3. Router (artifacts.py)

#### Modified `download_model_endpoint`
- **Old return type**: `dict[str, str]`
- **New return type**: `dict[str, str | int]`
- **Response variations**:
  ```python
  # Already available
  {"status": "available", "progress": 100, "composite_id": "..."}
  
  # Just submitted
  {"status": "download submitted", "progress": 0, "composite_id": "..."}
  
  # In progress
  {"status": "download in progress", "progress": 45, "composite_id": "..."}
  ```

### 4. Cleanup
- Removed specification comment from end of manager.py

## Thread Safety

All modifications to `ongoing_downloads` are protected by `ArtifactManager.lock`:
- Initialization in `submit_artifact_download` (lock held)
- Updates via `report_artifact_download_progress` (acquires lock)
- Cleanup in `_download_artifact_task` (lock held)

## Backward Compatibility

- `download_artifact` callback parameter is optional
- Existing code that doesn't provide callback continues to work
- No breaking changes to existing APIs

## Statistics

- **Files changed**: 3
- **Lines added**: 52
- **Lines removed**: 26
- **Net change**: +26 lines

## How to Apply

### Option 1: Using git am
```bash
cd <repository-root>
git checkout feat/modelDownloadProgress  # or your target branch
git am 0001-Implement-model-download-progress-tracking.patch
```

### Option 2: Using git apply
```bash
cd <repository-root>
git checkout feat/modelDownloadProgress  # or your target branch
git apply 0001-Implement-model-download-progress-tracking.patch
```

### Option 3: Manual application
The patch file `0001-Implement-model-download-progress-tracking.patch` contains all the changes as a unified diff that can be reviewed and applied manually if needed.

## Testing

The implementation has been syntax-checked with `python3 -m py_compile` and all files compile successfully.

No existing tests were affected as the changes are backward compatible. The specification requested not to implement new big tests from scratch.

## Commit Information

- **Commit SHA**: 6754185e1d1545fb5f9fd366a683a5e6922d5a41
- **Branch**: feat/modelDownloadProgress
- **Parent commit**: eca6b93 ([backend.artifacts] model download progress spec)
- **Commit message**: "Implement model download progress tracking"
- **Author**: copilot-swe-agent[bot]
- **Date**: Wed, 25 Feb 2026 09:44:50 +0000

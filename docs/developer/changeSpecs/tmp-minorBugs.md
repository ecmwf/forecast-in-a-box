# Minor bugs: local `file://` artifact copy reports failures as success

## Scope

Two small bugs in `backend/src/forecastbox/domain/artifact/io.py::_download_artifact_local`,
in the branch that handles a catalog entry whose `url` starts with `file://`
(the artifact is hardlinked, or copied as a fallback, into local storage).
Both cause a failed copy to be reported as a successful download.

The fix is confined to that function and its unit tests. No other module needs
to change.

## Current behaviour

```python
if checkpoint.url.startswith("file://"):
    try:
        ...
        try:
            os.link(src_path, target_path)
            logger.info(...hardlinked...)
        except OSError as e:
            if e.errno == errno.EXDEV:
                shutil.copy(src_path, target_path)
                logger.info(...copied...)
        if progress_callback:
            progress_callback(100)
    except Exception as e:
        logger.error(f"Failed to copy artifact {composite_id}: {e}")
    return
```

1. **Non-`EXDEV` link errors are silently ignored.** If `os.link` raises an
   `OSError` other than `EXDEV` (source missing, permission denied, target
   already exists, unsupported filesystem, ...), the inner `except` does
   nothing: no copy, no log, and execution continues to
   `progress_callback(100)` and returns normally.
2. **Any copy failure is swallowed.** The outer `except Exception` logs at
   error level and then returns normally, so a failing `shutil.copy` (or a
   failure in the path resolution) also returns normally.

`download_artifact` returning normally means the caller,
`domain/artifact/manager.py::_download_artifact_task`, treats the artifact as
downloaded. It adds the artifact to `locally_available` and sends the
"finished successfully" notification, even though no file exists at the
target path. A run that depends on the artifact then fails later in cascade
with a confusing missing-file error, instead of at download time.

The HTTP branch of the same function already behaves correctly: it cleans up
and re-raises.

## Fix

1. In the inner `except OSError as e`, fall back to `shutil.copy` only for
   `errno.EXDEV`, and re-raise every other `OSError`. This includes `EEXIST`:
   a download is only submitted for an artifact that is not known to be
   available, so an existing file at the target path is an inconsistent
   state. It should surface as a failure, not be silently accepted.
2. Change the outer `except Exception` to log with `logger.exception`
   (keeping the existing message) and then `raise`. Do not catch and
   return.
3. If `shutil.copy` fails after creating a partial target file, remove the
   partial file before re-raising, mirroring the temp-file cleanup of the HTTP
   branch. Use `artifact_path.unlink(missing_ok=True)` in the failure path.
   Make sure this never deletes a pre-existing file that the `EEXIST` case
   refused to overwrite: only clean up when the copy was actually attempted.
4. Call `progress_callback(100)` only after a successful link or copy, as
   today.

## Tests

Add to `backend/tests/unit/test_artifacts.py`, using a temporary directory and
a sample artifact whose `common.url` is `file://<tmp>/source.ckpt`:

- successful hardlink: the target exists, `progress_callback(100)` is called,
  and no exception is raised;
- `os.link` raising `OSError(errno.EXDEV, ...)` (patched): falls back to copy,
  the target exists, and no exception is raised;
- `os.link` raising `OSError(errno.EACCES, ...)` (patched): the call raises,
  `progress_callback` is not called, and no target file is created;
- missing source file: the call raises;
- `EXDEV` fallback where `shutil.copy` raises (patched to write a partial file
  and then fail): the call raises and the partial target is removed.

Run the artifact unit tests, type checking, and `uv run prek`.

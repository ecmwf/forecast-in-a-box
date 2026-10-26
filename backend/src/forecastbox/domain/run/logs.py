# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Run logs archive creation.

Also hosts archive creation for run output directories.

Queries the gateway for the job state and packages it, the run record and the
matching log files into an in-memory ZIP archive. Blocking work is executed on
named execution-manager pools.
"""

import io
import logging
import os
import pathlib
import zipfile
from dataclasses import asdict
from functools import partial

import orjson
from cascade.controller.report import JobId
from cascade.gateway import api, client

from forecastbox.domain.gateway.service import get_gateway_url, get_logs_directory
from forecastbox.domain.run.db import RunRecord
from forecastbox.domain.run.exceptions import OutputPathNotFound, RunLogsArchiveFailed
from forecastbox.utility.concurrency.manager import TaskName, execution_manager
from forecastbox.utility.config import ConcurrentPools

logger = logging.getLogger(__name__)


def fetch_gateway_job_state(cascade_job_id: str) -> dict:
    """Blocking gateway query; never raises, errors are embedded in the returned dict."""
    try:
        request = api.JobProgressRequest(job_ids=[JobId(cascade_job_id)])
        return client.request_response(request, get_gateway_url()).model_dump()
    except TimeoutError:
        return {"progresses": {}, "datasets": {}, "error": "TimeoutError"}
    except Exception as e:
        return {"progresses": {}, "datasets": {}, "error": repr(e)}


def build_logs_archive(cascade_job_id: str, db_entity_ser: bytes, gw_state: dict) -> bytes:
    """Blocking disk work; raises RunLogsArchiveFailed on failure."""
    try:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "a", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("db_entity.json", db_entity_ser)
            zf.writestr("gw_state.json", orjson.dumps(gw_state))
            maybe_logs_directory = get_logs_directory()
            if maybe_logs_directory.t is None:
                zf.writestr("logs_directory.error.txt", f"logs directory missing: {maybe_logs_directory.e}")
            else:
                p = pathlib.Path(maybe_logs_directory.t.name)
                f = ""
                try:
                    for f in os.listdir(p):
                        j_pref = f"job_{cascade_job_id}"
                        if f == "backend.logs.txt" or f.startswith("gateway") or f.startswith(j_pref):
                            zf.write(f"{p / f}", arcname=f)
                except Exception as e:
                    zf.writestr("logs_directory.error.txt", f"{f} => {repr(e)}")
        return buffer.getvalue()
    except Exception as e:
        logger.exception("building zip")
        raise RunLogsArchiveFailed() from e


async def get_run_logs_archive(run: RunRecord) -> bytes:
    """Awaits the gateway query on the General pool, then the archive build on the Io pool."""
    cascade_job_id = run.cascade_job_id
    if cascade_job_id is None:
        raise ValueError("run has no cascade_job_id")
    db_entity_ser = orjson.dumps(asdict(run))
    gw_state = await execution_manager.awaitable_submit(
        ConcurrentPools.General,
        TaskName("run.logs.gateway-state"),
        partial(fetch_gateway_job_state, cascade_job_id),
    )
    return await execution_manager.awaitable_submit(
        ConcurrentPools.Io,
        TaskName("run.logs.build-archive"),
        partial(build_logs_archive, cascade_job_id, db_entity_ser, gw_state),
    )


# NOTE it does not exactly fit here, but we expected this function to be eventually replaced by something else
def build_output_archive(path: pathlib.Path, root_name: str) -> bytes:
    """Blocking disk work; zips the file or directory tree at path, raises RunLogsArchiveFailed on failure."""
    try:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(path, arcname=root_name)
            if path.is_dir():
                for dirpath, dirnames, filenames in os.walk(path):
                    dirnames.sort()
                    base = pathlib.Path(dirpath)
                    for d in dirnames:
                        zf.write(base / d, arcname=str(pathlib.Path(root_name) / (base / d).relative_to(path)))
                    for f in sorted(filenames):
                        zf.write(base / f, arcname=str(pathlib.Path(root_name) / (base / f).relative_to(path)))
        return buffer.getvalue()
    except Exception as e:
        logger.exception("building output zip")
        raise RunLogsArchiveFailed() from e


async def get_output_archive(path: pathlib.Path) -> tuple[bytes, str]:
    """Returns the zipped output at path and the archive root name; the build runs on the Io pool."""
    if not path.exists():
        raise OutputPathNotFound(str(path))
    root_name = path.resolve().name or "output"
    archive = await execution_manager.awaitable_submit(
        ConcurrentPools.Io,
        TaskName("run.output.build-archive"),
        partial(build_output_archive, path, root_name),
    )
    return archive, root_name

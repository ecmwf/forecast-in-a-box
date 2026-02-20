import os
import tempfile
import time
from datetime import datetime, timedelta

import httpx
from fiab_core.fable import BlockInstance, PluginBlockFactoryId, PluginCompositeId

from forecastbox.api.types import EnvironmentSpecification, ExecutionSpecification, RawCascadeJob
from forecastbox.api.types.fable import FableBuilderV1
from forecastbox.config import FIABConfig
from forecastbox.standalone.entrypoint import launch_all


def ensure_completed(backend_client, job_id, sleep=0.5, attempts=20):
    while attempts > 0:
        response = backend_client.get("/job/status", timeout=10)
        assert response.is_success
        status = response.json()["progresses"][job_id]["status"]
        if status == "failed":
            raise RuntimeError(f"Job {job_id} failed: {response.json()['progresses'][job_id]['error']}")
        # TODO parse response with corresponding class, define a method `not_failed` instead
        assert status in {"submitted", "running", "completed"}
        if status == "completed":
            break
        time.sleep(sleep)
        attempts -= 1

    assert attempts > 0, f"Failed to finish job {job_id}"


if __name__ == "__main__":
    handles = None
    dbDir = None
    dataDir = None
    try:
        config = FIABConfig()
        config.api.uvicorn_port = 30645
        config.auth.passthrough = True
        config.cascade.cascade_url = "tcp://localhost:30644"
        config.general.launch_browser = False
        if os.environ.get("UNCLEAN", "") != "yea":
            dbDir = tempfile.TemporaryDirectory()
            config.db.sqlite_userdb_path = f"{dbDir.name}/user.db"
            config.db.sqlite_jobdb_path = f"{dbDir.name}/job.db"
            dataDir = tempfile.TemporaryDirectory()
            config.api.data_path = dataDir.name

        handles = launch_all(config, attempts=50)
        client = httpx.Client(base_url=config.api.local_url() + "/api/v1", follow_redirects=True)

        tmpdir = tempfile.TemporaryDirectory()
        response = client.get("/fable/catalogue").raise_for_status()
        assert len(response.json()) > 0

        pluginId = PluginCompositeId(store="ecmwf", local="ecmwf-base")
        blocks = {
            "source1": BlockInstance(
                factory_id=PluginBlockFactoryId(plugin=pluginId, factory="ekdSource"),
                configuration_values={
                    "source": "ecmwf-open-data",
                    "date": (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d"),
                    "expver": "0001",
                },
                input_ids={},
            ),
            "temporalMean": BlockInstance(
                factory_id=PluginBlockFactoryId(plugin=pluginId, factory="temporalStatistics"),
                configuration_values={"variable": "2t", "statistic": "mean"},
                input_ids={"dataset": "source1"},
            ),
        }
        for statistic in ["mean", "std"]:
            block = BlockInstance(
                factory_id=PluginBlockFactoryId(plugin=pluginId, factory="ensembleStatistics"),
                configuration_values={"variable": "2t", "statistic": statistic},
                input_ids={"dataset": "temporalMean"},
            )
            sink = BlockInstance(
                factory_id=PluginBlockFactoryId(plugin=pluginId, factory="zarrSink"),
                configuration_values={"path": f"{tmpdir}/output.zarr"},
                input_ids={"dataset": f"ensemble{statistic.capitalize()}"},
            )
            blocks[f"ensemble{statistic.capitalize()}"] = block
            blocks[f"sink{statistic.capitalize()}"] = sink

        builder = FableBuilderV1(blocks=blocks)
        response = client.request(url="/fable/compile", method="put", json=builder.model_dump())

        spec = ExecutionSpecification(
            job=RawCascadeJob(**response.json()),
            environment=EnvironmentSpecification(hosts=1, workers_per_host=1),
        )
        response = client.post("/execution/execute", json=spec.model_dump())
        assert response.is_success
        job_id = response.json()["id"]
        ensure_completed(client, job_id, sleep=1, attempts=120)

        response = client.get(url=f"/job/{job_id}/outputs")
        assert len(response.json()) == 1
        assert os.path.exists(f"{tmpdir}/output.zarr")
        tmpdir.cleanup()

    finally:
        if handles is not None:
            handles.shutdown()
        if dataDir is not None:
            dataDir.cleanup()
        if dbDir is not None:
            dbDir.cleanup()

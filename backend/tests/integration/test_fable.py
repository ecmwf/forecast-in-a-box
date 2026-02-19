import os

from fiab_core.fable import BlockInstance, PluginBlockFactoryId, PluginCompositeId

from forecastbox.api.types import EnvironmentSpecification, ExecutionSpecification, RawCascadeJob
from forecastbox.api.types.fable import FableBuilderV1

from .utils import ensure_completed

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")


def test_fable_contruction(tmpdir, backend_client_with_auth):
    response = backend_client_with_auth.get("/fable/catalogue").raise_for_status()
    assert len(response.json()) > 0

    builder = FableBuilderV1(blocks={})
    response = backend_client_with_auth.request(url="/fable/expand", method="put", json=builder.model_dump())
    assert len(response.json()["possible_sources"]) == 1
    assert len(response.json()["possible_expansions"]) == 0

    pluginId = PluginCompositeId(store="ecmwf", local="ecmwf-base")
    source = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=pluginId, factory="ekdSource"),
        configuration_values={
            "source": "ecmwf-open-data",
            "date": "2026-02-18",
            "expver": "0001",
        },
        input_ids={},
    )
    blocks = {"source1": source}
    builder = FableBuilderV1(blocks=blocks)
    response = backend_client_with_auth.request(url="/fable/expand", method="put", json=builder.model_dump())
    assert len(response.json()["possible_expansions"]["source1"]) == 3

    temporalMean = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=pluginId, factory="temporalStatistics"),
        configuration_values={"variable": "2t", "statistic": "mean"},
        input_ids={"dataset": "source1"},
    )
    blocks["temporalMean"] = temporalMean
    builder = FableBuilderV1(blocks=blocks)
    response = backend_client_with_auth.request(url="/fable/expand", method="put", json=builder.model_dump())
    assert len(response.json()["possible_expansions"]["temporalMean"]) == 2

    for statistic in ["mean"]:
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
    response = backend_client_with_auth.request(url="/fable/expand", method="put", json=builder.model_dump())
    assert len(response.json()["possible_expansions"]["sinkMean"]) == 0
    assert len(response.json()["block_errors"]) == 0

    response = backend_client_with_auth.request(url="/fable/compile", method="put", json=builder.model_dump())
    assert len(response.json()["job_instance"]["tasks"]) > 0

    spec = ExecutionSpecification(
        job=RawCascadeJob(**response.json()),
        environment=EnvironmentSpecification(hosts=1, workers_per_host=1),
    )

    # Replace open data retrieval with reading from test data file
    for task in spec.job.job_instance.tasks.values():
        if task.definition.entrypoint == "fiab_plugin_ecmwf.runtime.source.earthkit_source":
            request = task.static_input_kw["request"]
            # Check request matches data inside test file
            assert request["number"] == list(range(1, 6, 1))
            assert request["step"] == list(range(0, 61, 6))
            task.static_input_ps["0"] = "file"
            task.static_input_kw["path"] = os.path.join(DATA_DIR, "test.grib")

    response = backend_client_with_auth.post("/execution/execute", json=spec.model_dump())
    assert response.is_success
    job_id = response.json()["id"]
    ensure_completed(backend_client_with_auth, job_id, sleep=1, attempts=120)

    response = backend_client_with_auth.get(url=f"/job/{job_id}/outputs")
    assert len(response.json()) == 1
    assert os.path.exists(f"{tmpdir}/output.zarr")

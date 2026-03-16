import os

from fiab_core.fable import BlockInstance, PluginBlockFactoryId, PluginCompositeId

from forecastbox.api.types.fable import FableBuilderV1
from forecastbox.api.types.jobs import EnvironmentSpecification, ExecutionSpecification, RawCascadeJob

from .utils import ensure_completed


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
    assert len(response.json()["possible_expansions"]["source1"]) > 0

    temporalMean = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=pluginId, factory="temporalStatistics"),
        configuration_values={"variable": "2t", "statistic": "mean"},
        input_ids={"dataset": "source1"},
    )
    blocks["temporalMean"] = temporalMean
    builder = FableBuilderV1(blocks=blocks)
    response = backend_client_with_auth.request(url="/fable/expand", method="put", json=builder.model_dump())
    assert len(response.json()["possible_expansions"]["temporalMean"]) > 0

    block = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=pluginId, factory="ensembleStatistics"),
        configuration_values={"variable": "2t", "statistic": "mean"},
        input_ids={"dataset": "temporalMean"},
    )
    sink = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=pluginId, factory="zarrSink"),
        configuration_values={"path": f"{tmpdir}/output.zarr"},
        input_ids={"dataset": f"ensembleMean"},
    )
    blocks[f"ensembleMean"] = block
    blocks[f"sinkMean"] = sink

    builder = FableBuilderV1(blocks=blocks)
    response = backend_client_with_auth.request(url="/fable/expand", method="put", json=builder.model_dump())
    assert len(response.json()["possible_expansions"]["sinkMean"]) == 0
    assert len(response.json()["block_errors"]) == 0

    response = backend_client_with_auth.request(url="/fable/compile", method="put", json=builder.model_dump()).json()
    assert len(response["job"]["job_instance"]["tasks"]) > 0

    spec = ExecutionSpecification(**response)
    spec.environment.hosts = 1
    spec.environment.workers_per_host = 1

    response = backend_client_with_auth.post("/job/execute", json=spec.model_dump())
    assert response.is_success
    job_id = response.json()["id"]
    ensure_completed(backend_client_with_auth, job_id, sleep=1, attempts=120)

    response = backend_client_with_auth.get(url=f"/job/{job_id}/outputs")
    assert len(response.json()) == 1
    assert os.path.exists(f"{tmpdir}/output.zarr")

    response = backend_client_with_auth.post(url=f"/job/flush")
    assert response.is_success

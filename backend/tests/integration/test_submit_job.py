import io
import os
import sys
import time
import zipfile

import cloudpickle
from cascade.low.builders import JobBuilder, TaskBuilder

from forecastbox.api.types import (
    EnvironmentSpecification,
    ExecutionSpecification,
    ForecastProducts,
    ModelSpecification,
    ProductSpecification,
    RawCascadeJob,
)


def _ensure_completed(backend_client, job_id):
    i = 20
    while i > 0:
        response = backend_client.get("/job/status")
        assert response.is_success
        status = response.json()["progresses"][job_id]["status"]
        # TODO parse response with corresponding class, define a method `not_failed` instead
        assert status in {"submitted", "running", "completed"}
        if status == "completed":
            break
        time.sleep(0.5)
        i -= 1

    assert i > 0, f"Failed to finish job {job_id}"


def test_submit_job(backend_client_with_auth):
    env = EnvironmentSpecification(hosts=1, workers_per_host=2)

    headers = {"Content-Type": "application/json"}

    response = backend_client_with_auth.get("/job/status")
    assert response.is_success
    # not existent
    response = backend_client_with_auth.get("/job/notToBeFound/status")
    assert response.status_code == 404

    # raw job
    job_instance = JobBuilder().with_node("n1", TaskBuilder.from_callable(eval).with_values("1+2")).build().get_or_raise()
    spec = ExecutionSpecification(
        job=RawCascadeJob(
            job_type="raw_cascade_job",
            job_instance=job_instance,
        ),
        environment=env,
    )
    response = backend_client_with_auth.post("/execution/execute", headers=headers, json=spec.model_dump())
    assert response.is_success
    raw_job_id = response.json()["id"]
    _ensure_completed(backend_client_with_auth, raw_job_id)

    outputs = backend_client_with_auth.get(f"/job/{raw_job_id}/outputs").raise_for_status().json()
    assert len(outputs) == 1
    assert "n1" in outputs[0]["output_ids"]
    # NOTE increased timeout below for mac because of delayed import
    kw_tm = {"timeout": 20.0} if sys.platform == "darwin" else {}
    output = backend_client_with_auth.get(f"/job/{raw_job_id}/results/n1", **kw_tm)
    assert cloudpickle.loads(output.content) == 3
    # NOTE we run the same request again, without timeout, to verify it was indeed delayed import
    output = backend_client_with_auth.get(f"/job/{raw_job_id}/results/n1")
    assert cloudpickle.loads(output.content) == 3

    logs = backend_client_with_auth.get(f"/job/{raw_job_id}/logs").raise_for_status().content
    with zipfile.ZipFile(io.BytesIO(logs), "r") as zf:
        # NOTE dbEntity, gwState, gateway, controller, host0, host0.dsr, host0.shm, host0.w1, host0.w2
        expected_log_count = 9
        assert len(zf.namelist()) == expected_log_count or os.getenv("FIAB_LOGSTDOUT", "nay") == "yea"

    # requests job
    def do_request() -> str:
        import requests

        # NOTE the usage of `requests` is to test macos behavior under forking
        assert requests.get("http://google.com").status_code == 200
        return "ok"

    job_instance = JobBuilder().with_node("n1", TaskBuilder.from_callable(do_request)).build().get_or_raise()
    spec = ExecutionSpecification(
        job=RawCascadeJob(job_type="raw_cascade_job", job_instance=job_instance),
        environment=env,
    )
    response = backend_client_with_auth.post("/execution/execute", headers=headers, json=spec.model_dump())
    assert response.is_success
    requests_job_id = response.json()["id"]
    _ensure_completed(backend_client_with_auth, requests_job_id)

    # no ckpt spec
    spec = ExecutionSpecification(
        job=ForecastProducts(
            job_type="forecast_products",
            model=ModelSpecification(model="missing", date="today", lead_time=1, ensemble_members=1),
            products=[ProductSpecification(product="test", specification={})],
        ),
        environment=env,
    )
    response = backend_client_with_auth.post("/execution/execute", headers=headers, json=spec.model_dump())
    assert response.is_success
    no_ckpt_id = response.json()["id"]

    response = backend_client_with_auth.get("/job/status")
    assert response.is_success
    # TODO retry in case of error not present yet
    assert "No such file or directory" in response.json()["progresses"][no_ckpt_id]["error"]

    # valid spec
    spec = ExecutionSpecification(
        job=ForecastProducts(
            job_type="forecast_products",
            model=ModelSpecification(model="test", date="today", lead_time=1, ensemble_members=1),
            products=[],
        ),
        environment=env,
    )
    response = backend_client_with_auth.post("/execution/execute", headers=headers, json=spec.model_dump())
    assert response.is_success
    test_model_id = response.json()["id"]

    response = backend_client_with_auth.get("/job/status")
    assert response.is_success
    # TODO fix the file to comply with the validation, then test the workflow success
    # TODO retry in case of error not present yet
    assert "Could not find 'ai-models.json'" in response.json()["progresses"][test_model_id]["error"]

    # sleeper job
    def sleep_with_sgn(secs: int):
        import time

        time.sleep(secs)

    job_instance = JobBuilder().with_node("n1", TaskBuilder.from_callable(sleep_with_sgn).with_values(10)).build().get_or_raise()
    spec = ExecutionSpecification(
        job=RawCascadeJob(
            job_type="raw_cascade_job",
            job_instance=job_instance,
        ),
        environment=env,
    )
    response = backend_client_with_auth.post("/execution/execute", headers=headers, json=spec.model_dump())
    assert response.is_success
    sleeper_id = response.json()["id"]

    # delete job
    response = backend_client_with_auth.delete(f"/job/{raw_job_id}").raise_for_status().json()
    assert response["deleted_count"] == 1
    response = backend_client_with_auth.get("/job/status").raise_for_status().json()
    assert len(response["progresses"].keys()) == 4

    # gateway unavailable/restarted
    backend_client_with_auth.post("/gateway/kill").raise_for_status()
    response = backend_client_with_auth.get("/job/status").raise_for_status().json()
    assert len(response["progresses"].keys()) == 4
    assert response["progresses"][sleeper_id]["status"] == "timeout"
    assert response["progresses"][sleeper_id]["error"] == "failed to communicate with gateway"

    backend_client_with_auth.post("/gateway/start").raise_for_status()
    response = backend_client_with_auth.get("/job/status").raise_for_status().json()
    assert len(response["progresses"].keys()) == 4
    assert response["progresses"][sleeper_id]["status"] == "invalid"
    assert response["progresses"][sleeper_id]["error"] == "evicted from gateway"

    # delete all jobs
    response = backend_client_with_auth.post("/job/flush").raise_for_status().json()
    assert response["deleted_count"] == 4
    response = backend_client_with_auth.get("/job/status").raise_for_status().json()

import io
import os
import sys
import time
import zipfile

import cloudpickle
import pytest
from cascade.low.builders import JobBuilder, TaskBuilder

from forecastbox.api.types.jobs import (
    EnvironmentSpecification,
    ExecutionSpecification,
    RawCascadeJob,
)

from .utils import ensure_completed


def test_submit_job(backend_client_with_auth):
    pytest.skip("disabled until test plugin is available")
    # TODO this test is disabled because the endpoints are being removed. However,
    # some coverage of this test has not yet been migrated, because we cannot
    # properly submit raw jobs or mock them at the moment. Once that is available,
    # revisit this test. Thus, do not delete this file or its content, despite being
    # unreachable!
    # In brief, we need to test job delete, request making from job, gateway restarts,
    # job output consumption, sleeper jobs.
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
    response = backend_client_with_auth.post("/job/execute", headers=headers, json=spec.model_dump())
    assert response.is_success
    raw_job_id = response.json()["id"]
    ensure_completed(backend_client_with_auth, raw_job_id)

    outputs = backend_client_with_auth.get(f"/job/{raw_job_id}/outputs").raise_for_status().json()
    assert len(outputs) == 1
    assert "n1" in outputs[0]["output_ids"]
    # NOTE increased timeout below for mac because of delayed import
    kw_tm = {"timeout": 40.0} if sys.platform == "darwin" else {}
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
    response = backend_client_with_auth.post("/job/execute", headers=headers, json=spec.model_dump())
    assert response.is_success
    requests_job_id = response.json()["id"]
    ensure_completed(backend_client_with_auth, requests_job_id)

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
    response = backend_client_with_auth.post("/job/execute", headers=headers, json=spec.model_dump())
    assert response.is_success
    sleeper_id = response.json()["id"]

    # delete job
    response = backend_client_with_auth.delete(f"/job/{raw_job_id}").raise_for_status().json()
    assert response["deleted_count"] == 1
    response = backend_client_with_auth.get("/job/status").raise_for_status().json()
    assert len(response["progresses"].keys()) == 2

    # gateway unavailable/restarted
    backend_client_with_auth.post("/gateway/kill").raise_for_status()
    response = backend_client_with_auth.get("/job/status").raise_for_status().json()
    assert len(response["progresses"].keys()) == 2
    assert response["progresses"][sleeper_id]["status"] == "timeout"
    assert response["progresses"][sleeper_id]["error"] == "failed to communicate with gateway"

    backend_client_with_auth.post("/gateway/start").raise_for_status()
    response = backend_client_with_auth.get("/job/status").raise_for_status().json()
    assert len(response["progresses"].keys()) == 2
    assert response["progresses"][sleeper_id]["status"] == "invalid"
    assert response["progresses"][sleeper_id]["error"] == "evicted from gateway"

    # delete all jobs
    response = backend_client_with_auth.post("/job/flush").raise_for_status().json()
    assert response["deleted_count"] == 2
    response = backend_client_with_auth.get("/job/status").raise_for_status().json()

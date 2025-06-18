from forecastbox.api.types import (
    ProductSpecification,
    EnvironmentSpecification,
    ExecutionSpecification,
    ModelSpecification,
    ForecastProducts,
    RawCascadeJob,
)
import time
from cascade.low.builders import JobBuilder, TaskBuilder
import cloudpickle


# @pytest.mark.skip(reason="requires mongodb still")
def test_submit_job(backend_client):
    headers = {"Content-Type": "application/json"}
    data = {"email": "executor@somewhere.org", "password": "something"}
    response = backend_client.post("/auth/register", headers=headers, json=data)
    assert response.is_success
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    data = {"username": "executor@somewhere.org", "password": "something"}
    response = backend_client.post("/auth/jwt/login", data=data)
    assert response.is_success
    token = response.json()["access_token"]

    response = backend_client.get("/job/status")
    assert response.is_success

    headers = {"Authorization": f"Bearer {token}"}

    # raw job
    job_instance = JobBuilder().with_node("n1", TaskBuilder.from_callable(eval).with_values("1+2")).build().get_or_raise()
    spec = ExecutionSpecification(
        job=RawCascadeJob(
            job_type="raw_cascade_job",
            job_instance=job_instance,
        ),
        environment=EnvironmentSpecification(),
    )
    response = backend_client.post("/graph/execute", headers=headers, json=spec.model_dump())
    assert response.is_success
    raw_job_id = response.json()["id"]

    i = 6
    while i > 0:
        response = backend_client.get("/job/status")
        assert response.is_success
        status = response.json()["progresses"][raw_job_id]["status"]
        # TODO parse response with corresponding class, define a method `not_failed` instead
        assert status in {"submitting", "submitted", "running", "completed"}
        if status == "completed":
            break
        time.sleep(0.3)
        i -= 1

    assert i > 0, "Failed to finish job"

    outputs = backend_client.get(f"/job/{raw_job_id}/outputs").raise_for_status().json()
    assert outputs == ["n1"]
    output = backend_client.get(f"/job/{raw_job_id}/n1")
    assert cloudpickle.loads(output.content) == 3

    # no ckpt spec
    spec = ExecutionSpecification(
        job=ForecastProducts(
            job_type="forecast_products",
            model=ModelSpecification(model="missing", date="today", lead_time=1, ensemble_members=1),
            products=[ProductSpecification(product="test", specification={})],
        ),
        environment=EnvironmentSpecification(),
    )
    response = backend_client.post("/graph/execute", headers=headers, json=spec.model_dump())
    assert response.is_success
    no_ckpt_id = response.json()["id"]

    response = backend_client.get("/job/status")
    assert response.is_success
    # TODO retry in case of error not present yet
    assert "Path does not point to a file" in response.json()["progresses"][no_ckpt_id]["error"]

    # valid spec
    spec = ExecutionSpecification(
        job=ForecastProducts(
            job_type="forecast_products",
            model=ModelSpecification(model="test", date="today", lead_time=1, ensemble_members=1),
            products=[],
        ),
        environment=EnvironmentSpecification(),
    )
    response = backend_client.post("/graph/execute", headers=headers, json=spec.model_dump())
    assert response.is_success
    test_model_id = response.json()["id"]

    response = backend_client.get("/job/status")
    assert response.is_success
    # TODO fix the file to comply with the validation, then test the workflow success
    # TODO retry in case of error not present yet
    assert "Could not find 'ai-models.json'" in response.json()["progresses"][test_model_id]["error"]

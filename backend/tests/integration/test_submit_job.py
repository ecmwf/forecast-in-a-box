from forecastbox.api.types import ProductSpecification, EnvironmentSpecification, ExecutionSpecification, ModelSpecification


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

    # TODO submit meaningful job
    spec = ExecutionSpecification(
        model=ModelSpecification(model="test", date="today", lead_time=1, ensemble_members=1),
        products=[ProductSpecification(product="test", specification={})],
        environment=EnvironmentSpecification(),
    )
    data = spec.model_dump()
    response = backend_client.post("/graph/execute", headers=headers, json=data)
    assert response.is_success

    # TODO retrieve status

    # TODO fix the warning in forecastbox.models.model, with the Config class, by ConfigDict

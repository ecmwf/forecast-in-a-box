from cascade.low.builders import JobBuilder, TaskBuilder
from forecastbox.api.types import EnvironmentSpecification, ExecutionSpecification, RawCascadeJob, ScheduleSpecification


def test_schedule_crud(backend_client_with_auth):
    response = backend_client_with_auth.get("/schedule/notToBeFound")
    assert response.status_code == 404

    job_instance = (
        JobBuilder().with_node("n1", TaskBuilder.from_callable(eval).with_values("1+2")).build().get_or_raise()
    )
    env = EnvironmentSpecification(hosts=1, workers_per_host=2)
    exec_spec = ExecutionSpecification(
        job=RawCascadeJob(
            job_type="raw_cascade_job",
            job_instance=job_instance,
        ),
        environment=env,
    )
    sched_spec = ScheduleSpecification(
        exec_spec=exec_spec,
        dynamic_expr={},
        cron_expr="0 0 * * *",
    )

    headers = {"Content-Type": "application/json"}
    response = backend_client_with_auth.put("/schedule/create", headers=headers, json=sched_spec.model_dump())
    assert response.is_success
    sched_id = response.json()["schedule_id"]

    response = backend_client_with_auth.get(f"/schedule/{sched_id}")
    assert response.is_success

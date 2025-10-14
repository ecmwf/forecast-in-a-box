from datetime import datetime as dt

from cascade.low.builders import JobBuilder, TaskBuilder
from forecastbox.api.types import (EnvironmentSpecification, ExecutionSpecification, RawCascadeJob,
                                   ScheduleSpecification, ScheduleUpdate)


def test_schedule_crud(backend_client_with_auth):
    # miss
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

    # create
    headers = {"Content-Type": "application/json"}
    response = backend_client_with_auth.put("/schedule/create", headers=headers, json=sched_spec.model_dump())
    assert response.is_success
    sched_id = response.json()["schedule_id"]

    # get
    response = backend_client_with_auth.get(f"/schedule/{sched_id}")
    assert response.is_success

    # update
    updated_cron_expr = "0 1 * * *"
    schedule_update = ScheduleUpdate(cron_expr=updated_cron_expr, enabled=False)
    response = backend_client_with_auth.post(f"/schedule/{sched_id}", headers=headers, json=schedule_update.model_dump(exclude_unset=True))
    assert response.is_success
    updated_schedule = response.json()
    assert updated_schedule["cron_expr"] == updated_cron_expr
    assert updated_schedule["enabled"] is False
    response = backend_client_with_auth.get(f"/schedule/{sched_id}")
    assert response.is_success
    retrieved_schedule = response.json()
    assert retrieved_schedule["cron_expr"] == updated_cron_expr
    assert retrieved_schedule["enabled"] is False


def test_get_multiple_schedules(backend_client_with_auth):
    headers = {"Content-Type": "application/json"}

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

    # create
    sched_spec_1 = ScheduleSpecification(exec_spec=exec_spec, dynamic_expr={}, cron_expr="0 0 * * *")
    response = backend_client_with_auth.put("/schedule/create", headers=headers, json=sched_spec_1.model_dump())
    assert response.is_success
    sched_id_1 = response.json()["schedule_id"]
    sched_spec_2 = ScheduleSpecification(exec_spec=exec_spec, dynamic_expr={}, cron_expr="0 0 * * *")
    response = backend_client_with_auth.put("/schedule/create", headers=headers, json=sched_spec_2.model_dump())
    assert response.is_success
    sched_id_2 = response.json()["schedule_id"]
    sched_spec_3 = ScheduleSpecification(exec_spec=exec_spec, dynamic_expr={}, cron_expr="0 0 * * *")
    response = backend_client_with_auth.put("/schedule/create", headers=headers, json=sched_spec_3.model_dump())
    assert response.is_success
    sched_id_3 = response.json()["schedule_id"]

    # update: disable
    schedule_update_2 = ScheduleUpdate(enabled=False)
    response = backend_client_with_auth.post(f"/schedule/{sched_id_2}", headers=headers, json=schedule_update_2.model_dump(exclude_unset=True))
    assert response.is_success

    creation_time = dt.now() # we do it a bit later, to ensure db in sync

    # filter: enabled
    response = backend_client_with_auth.get("/schedule/?enabled=true")
    assert response.is_success
    enabled_schedules = response.json()
    assert len(enabled_schedules) >= 2 # at least sched_id_1 and sched_id_3
    assert any(s["schedule_id"] == sched_id_1 for s in enabled_schedules)
    assert any(s["schedule_id"] == sched_id_3 for s in enabled_schedules)
    assert not any(s["schedule_id"] == sched_id_2 for s in enabled_schedules)
    response = backend_client_with_auth.get("/schedule/?enabled=false")
    assert response.is_success
    disabled_schedules = response.json()
    assert len(disabled_schedules) >= 1 # at least sched_id_2
    assert any(s["schedule_id"] == sched_id_2 for s in disabled_schedules)
    assert not any(s["schedule_id"] == sched_id_1 for s in disabled_schedules)
    assert not any(s["schedule_id"] == sched_id_3 for s in disabled_schedules)

    # filter: created at
    sched_spec_4 = ScheduleSpecification(exec_spec=exec_spec, dynamic_expr={}, cron_expr="0 0 * * *")
    response = backend_client_with_auth.put("/schedule/create", headers=headers, json=sched_spec_4.model_dump())
    assert response.is_success
    sched_id_4 = response.json()["schedule_id"]

    response = backend_client_with_auth.get(f"/schedule/?created_at_end={creation_time.isoformat()}")
    assert response.is_success
    nonrecent_schedules = response.json()
    assert len(nonrecent_schedules) >= 3
    assert any(s["schedule_id"] == sched_id_1 for s in nonrecent_schedules)
    assert any(s["schedule_id"] == sched_id_2 for s in nonrecent_schedules)
    assert any(s["schedule_id"] == sched_id_3 for s in nonrecent_schedules)
    assert not any(s["schedule_id"] == sched_id_4 for s in nonrecent_schedules)

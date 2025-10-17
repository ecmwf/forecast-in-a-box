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
    enabled_schedules_response = response.json()
    enabled_schedules = enabled_schedules_response["schedules"]
    assert enabled_schedules_response["total"] >= 2
    assert enabled_schedules_response["page"] == 1
    assert enabled_schedules_response["page_size"] == 10
    assert sched_id_1 in enabled_schedules
    assert sched_id_3 in enabled_schedules
    assert sched_id_2 not in enabled_schedules

    response = backend_client_with_auth.get("/schedule/?enabled=false")
    assert response.is_success
    disabled_schedules_response = response.json()
    disabled_schedules = disabled_schedules_response["schedules"]
    assert disabled_schedules_response["total"] >= 1
    assert disabled_schedules_response["page"] == 1
    assert disabled_schedules_response["page_size"] == 10
    assert sched_id_2 in disabled_schedules
    assert sched_id_1 not in disabled_schedules
    assert sched_id_3 not in disabled_schedules

    # filter: created at
    sched_spec_4 = ScheduleSpecification(exec_spec=exec_spec, dynamic_expr={}, cron_expr="0 0 * * *")
    response = backend_client_with_auth.put("/schedule/create", headers=headers, json=sched_spec_4.model_dump())
    assert response.is_success
    sched_id_4 = response.json()["schedule_id"]

    response = backend_client_with_auth.get(f"/schedule/?created_at_end={creation_time.isoformat()}")
    assert response.is_success
    nonrecent_schedules_response = response.json()
    nonrecent_schedules = nonrecent_schedules_response["schedules"]
    assert nonrecent_schedules_response["total"] >= 3
    assert nonrecent_schedules_response["page"] == 1
    assert nonrecent_schedules_response["page_size"] == 10
    assert sched_id_1 in nonrecent_schedules
    assert sched_id_2 in nonrecent_schedules
    assert sched_id_3 in nonrecent_schedules
    assert sched_id_4 not in nonrecent_schedules

    # pagination
    response = backend_client_with_auth.get("/schedule/")
    assert response.is_success
    all_schedules_response = response.json()
    total_schedules = all_schedules_response["total"]
    assert total_schedules >= 4

    # page 1, page_size 2
    response = backend_client_with_auth.get("/schedule/?page=1&page_size=2")
    assert response.is_success
    paginated_response = response.json()
    assert len(paginated_response["schedules"]) == 2
    assert paginated_response["total"] == total_schedules
    assert paginated_response["page"] == 1
    assert paginated_response["page_size"] == 2
    assert paginated_response["total_pages"] == (total_schedules + 1) // 2

    # page 2, page_size 2
    response = backend_client_with_auth.get("/schedule/?page=2&page_size=2")
    assert response.is_success
    paginated_response = response.json()
    assert len(paginated_response["schedules"]) == 2
    assert paginated_response["total"] == total_schedules
    assert paginated_response["page"] == 2
    assert paginated_response["page_size"] == 2
    assert paginated_response["total_pages"] == (total_schedules + 1) // 2

    # page too high
    response = backend_client_with_auth.get(f"/schedule/?page={paginated_response['total_pages'] + 1}&page_size=2")
    assert response.status_code == 404

    # invalid size
    response = backend_client_with_auth.get("/schedule/?page=1&page_size=0")
    assert response.status_code == 400

    # page too low
    response = backend_client_with_auth.get("/schedule/?page=0&page_size=1")
    assert response.status_code == 400

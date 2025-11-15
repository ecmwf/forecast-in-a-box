import httpx
from cascade.low.builders import JobBuilder, TaskBuilder
from forecastbox.api.types import EnvironmentSpecification, ExecutionSpecification, RawCascadeJob, ScheduleSpecification

# TODO this is just a helper script to test an existing instance. Ideally turn it into a proper bigtest
# In particular this needs launching the instance with a clean scheduling table, and with allow_scheduling
# Then one should observe in the logs that every minute a job is launched


def get_job():
    job_instance = JobBuilder().with_node("n1", TaskBuilder.from_callable(eval).with_values("1+2")).build().get_or_raise()
    env = EnvironmentSpecification(hosts=1, workers_per_host=2)
    exec_spec = ExecutionSpecification(
        job=RawCascadeJob(
            job_type="raw_cascade_job",
            job_instance=job_instance,
        ),
        environment=env,
    )
    return exec_spec


def get_sched():
    exec_spec = get_job()
    sched_spec = ScheduleSpecification(
        exec_spec=exec_spec,
        dynamic_expr={},
        cron_expr="* * * * *",
        max_acceptable_delay_hours=24,
    )
    return sched_spec


def create_schedule():
    client = httpx.Client(base_url="http://localhost:8000/api/v1", follow_redirects=True)
    resp = client.put("/schedule/create", json=get_sched().model_dump())
    print(resp)
    print(resp.json())


if __name__ == "__main__":
    create_schedule()

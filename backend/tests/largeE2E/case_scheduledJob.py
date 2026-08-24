# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""scheduledJob scenario.

Placeholder for now -- trivially succeeds by just re-checking backend liveness. The scheduling
flow itself (create a schedule, wait for a run to be produced by the background scheduler) still
needs reworking against the current `/experiment/*` API and a dedicated test plugin, see the
preserved draft below.
"""

from __future__ import annotations

import logging

import httpx
from common import wait_for_backend_ready

logger = logging.getLogger("forecastbox.tests.runner")


def run(client: httpx.Client) -> None:
    wait_for_backend_ready(client)
    logger.info("scheduledJob scenario is currently a placeholder -- see the module docstring/draft below for the intended rework")


# TODO migrate to the new apis. Needs a test plugin first

# import httpx
# from cascade.low.builders import JobBuilder, TaskBuilder
#
# from forecastbox.api.types.jobs import EnvironmentSpecification, ExecutionSpecification, RawCascadeJob
# from forecastbox.api.types.scheduling import ScheduleSpecification
#
## TODO this is just a helper script to test an existing instance. Ideally turn it into a proper bigtest
## In particular this needs launching the instance with a clean scheduling table, and with allow_scheduling
## Then one should observe in the logs that every minute a job is launched
#
#
# def get_job():
#    job_instance = JobBuilder().with_node("n1", TaskBuilder.from_callable(eval).with_values("1+2")).build().get_or_raise()
#    env = EnvironmentSpecification(hosts=1, workers_per_host=2)
#    exec_spec = ExecutionSpecification(
#        job=RawCascadeJob(
#            job_type="raw_cascade_job",
#            job_instance=job_instance,
#        ),
#        environment=env,
#    )
#    return exec_spec
#
#
# def get_sched():
#    exec_spec = get_job()
#    sched_spec = ScheduleSpecification(
#        exec_spec=exec_spec,
#        dynamic_expr={},
#        cron_expr="* * * * *",
#        max_acceptable_delay_hours=24,
#    )
#    return sched_spec
#
#
# def create_schedule():
#    client = httpx.Client(base_url="http://localhost:8000/api/v1", follow_redirects=True)
#    resp = client.put("/schedule/create", json=get_sched().model_dump())
#    print(resp)
#    print(resp.json())
#
#
# if __name__ == "__main__":
#    create_schedule()

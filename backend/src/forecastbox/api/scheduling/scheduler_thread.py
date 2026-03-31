# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Scheduler thread lifecycle management.

Canonical implementation has moved to
``forecastbox.domain.experiment.scheduling.scheduler_thread``.
This module re-exports everything for backward compatibility.
"""

from forecastbox.domain.experiment.scheduling.scheduler_thread import (  # noqa: F401
    Globals,
    SchedulerThread,
    prod_scheduler,
    scheduler_lock,
    sleep_duration_min,
    start_scheduler,
    status_scheduler,
    stop_scheduler,
    timeout_acquire_background,
    timeout_acquire_lifecycle,
    timeout_acquire_request,
)

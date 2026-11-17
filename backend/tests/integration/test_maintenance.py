# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Integration test for the periodic database maintenance thread and its admin trigger."""

import httpx

from .utils import retry_until

_THREAD = "database-garbage-collector"


def _collector(client: httpx.Client) -> dict:
    response = client.get("/status", timeout=10)
    response.raise_for_status()
    return response.json()["concurrency"]["threads"][_THREAD]


def test_trigger_cleanup(backend_client_admin: httpx.Client) -> None:
    thread = _collector(backend_client_admin)
    assert thread["alive"] is True
    assert thread["stage"] == 2
    assert thread["component_status"]["state"] in ("idle", "querying")
    before = thread["component_status"]["last_success_at"]

    backend_client_admin.post("/admin/triggerCleanup").raise_for_status()

    def _done(_: object) -> dict | None:
        status = _collector(backend_client_admin)["component_status"]
        success = status["last_success_at"]
        if success is not None and (before is None or success > before):
            return status
        return None

    status = retry_until(lambda: None, _done, attempts=40, sleep=0.25, error_msg="cleanup did not complete")
    assert status is not None
    assert status["last_result"]["total_rows"] >= 0


def test_trigger_cleanup_forbidden_for_user(backend_client_user: httpx.Client) -> None:
    assert backend_client_user.post("/admin/triggerCleanup").status_code == 403

# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import pathlib
import time

import httpx

from .utils import retry_until


def test_dbs_created(backend_client: httpx.Client) -> None:
    """Verify that databases were created during backend startup."""
    import forecastbox.utility.config

    fiab_root = forecastbox.utility.config.fiab_home
    assert (pathlib.Path(fiab_root) / "user.db").exists(), "user.db was not created on startup"
    assert (pathlib.Path(fiab_root) / "job.db").exists(), "job.db was not created on startup"


def test_plugin_install_state_persisted(backend_client: httpx.Client) -> None:
    """Verify the test plugin install is reported via /plugin/status with no install error."""

    def do_action() -> dict:
        response = backend_client.get("/plugin/status", timeout=10)
        assert response.is_success
        return response.json()

    def verify_ok(data: dict) -> dict | None:
        return data if data.get("updater_status") == "ok" else None

    status = retry_until(do_action, verify_ok, attempts=30, sleep=1.0, error_msg="Plugin loader did not reach 'ok' status")

    assert "plugin_install_errors" in status, "plugin_install_errors field missing from /plugin/status response"
    assert "localTest:single" not in status["plugin_install_errors"], (
        f"Test plugin reported an install error: {status['plugin_install_errors'].get('localTest:single')}"
    )

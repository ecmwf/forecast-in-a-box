# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import pathlib

import httpx

from .utils import retry_until


def test_dbs_created(backend_client: httpx.Client) -> None:
    """Verify that databases were created during backend startup."""
    import forecastbox.utility.config

    fiab_root = forecastbox.utility.config.fiab_home
    assert (pathlib.Path(fiab_root) / "user.db").exists(), "user.db was not created on startup"
    assert (pathlib.Path(fiab_root) / "job.db").exists(), "job.db was not created on startup"


def test_plugin_install_state_persisted(backend_client: httpx.Client) -> None:
    """Verify the test plugin install is reported via /status with no install error."""
    from .conftest import testPluginId

    def do_action() -> dict:
        response = backend_client.get("/status", timeout=10)
        assert response.is_success
        return response.json()

    def verify_ok(data: dict) -> dict | None:
        return data if data.get("plugins") == "ok" else None

    retry_until(do_action, verify_ok, attempts=30, sleep=1.0, error_msg="Plugin loader did not reach 'ok' status")

    listing_response = backend_client.get("/plugin/list", timeout=10)
    assert listing_response.is_success
    plugins = listing_response.json().get("plugins", {})
    plugin_key = str(testPluginId)
    plugin_detail = plugins.get(plugin_key, None)
    assert plugin_detail is not None, f"Test plugin {plugin_key!r} not found in /plugin/list"
    install_data = plugin_detail.get("install_data", None)
    assert install_data is not None, f"Test plugin has no install_data in /plugin/list"
    install_errors = install_data.get("install_errors", [])
    error_severities = [e.get("severity") for e in install_errors]
    assert "error" not in error_severities and "critical" not in error_severities, (
        f"Test plugin reported install error(s): {install_errors}"
    )

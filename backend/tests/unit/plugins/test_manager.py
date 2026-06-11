# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for PluginManager.status_brief() and plugins_ready().

These tests exercise the fix for the AttributeError that occurred when
``PluginManager.updater`` was ``None`` (i.e. before ``submit_load_plugins``
had been called).  The class-level attributes are patched for each test so
the real singleton state is never mutated.
"""

from __future__ import annotations

import threading
from unittest.mock import patch

import pytest

from forecastbox.domain.plugin.manager import PluginManager, plugins_ready, status_brief

# Patch targets — class attributes on PluginManager.
_UPDATER = "forecastbox.domain.plugin.manager.PluginManager.updater"
_UPDATER_ERROR = "forecastbox.domain.plugin.manager.PluginManager.updater_error"


# ---------------------------------------------------------------------------
# status_brief
# ---------------------------------------------------------------------------


def test_status_brief_not_initialized_when_updater_is_none() -> None:
    """status_brief() returns 'not_initialized' when updater is None.

    This is the scenario that previously raised AttributeError because
    ``None.is_alive()`` was called.
    """
    with (
        patch.object(PluginManager, "updater", None),
        patch.object(PluginManager, "updater_error", None),
    ):
        assert status_brief() == "not_initialized"


def test_status_brief_failure_when_updater_error_set() -> None:
    """status_brief() returns a failure string when updater_error is set."""
    with (
        patch.object(PluginManager, "updater", None),
        patch.object(PluginManager, "updater_error", "something went wrong"),
    ):
        result = status_brief()

    assert result.startswith("failure:")
    assert "something went wrong" in result


def test_status_brief_running_when_thread_alive() -> None:
    """status_brief() returns 'running' when the updater thread is alive."""
    alive_thread = threading.Thread(target=lambda: None)
    alive_thread.start()
    # Give the thread a moment to start so is_alive() is True
    alive_thread.join(timeout=0)  # don't wait — just check

    # Use a mock that always reports alive to avoid a race condition.
    from unittest.mock import MagicMock

    mock_thread = MagicMock(spec=threading.Thread)
    mock_thread.is_alive.return_value = True

    with (
        patch.object(PluginManager, "updater", mock_thread),
        patch.object(PluginManager, "updater_error", None),
    ):
        assert status_brief() == "running"


def test_status_brief_ok_when_thread_finished() -> None:
    """status_brief() returns 'ok' when the updater thread has finished."""
    from unittest.mock import MagicMock

    mock_thread = MagicMock(spec=threading.Thread)
    mock_thread.is_alive.return_value = False

    with (
        patch.object(PluginManager, "updater", mock_thread),
        patch.object(PluginManager, "updater_error", None),
    ):
        assert status_brief() == "ok"


# ---------------------------------------------------------------------------
# plugins_ready
# ---------------------------------------------------------------------------


def test_plugins_ready_false_when_updater_is_none() -> None:
    """plugins_ready() returns False when updater is None (not yet initialized).

    This is the root-cause scenario: previously an AttributeError was raised
    here, which propagated into resolve_value_type and was swallowed by the
    broad except clause, causing noisy ERROR log output.
    """
    with (
        patch.object(PluginManager, "updater", None),
        patch.object(PluginManager, "updater_error", None),
    ):
        assert plugins_ready() is False


def test_plugins_ready_false_when_updater_error_set() -> None:
    """plugins_ready() returns False when there is an updater error."""
    with (
        patch.object(PluginManager, "updater", None),
        patch.object(PluginManager, "updater_error", "pip failed"),
    ):
        assert plugins_ready() is False


def test_plugins_ready_false_when_thread_running() -> None:
    """plugins_ready() returns False while the updater thread is still running."""
    from unittest.mock import MagicMock

    mock_thread = MagicMock(spec=threading.Thread)
    mock_thread.is_alive.return_value = True

    with (
        patch.object(PluginManager, "updater", mock_thread),
        patch.object(PluginManager, "updater_error", None),
    ):
        assert plugins_ready() is False


def test_plugins_ready_true_when_thread_finished() -> None:
    """plugins_ready() returns True only when the updater thread has finished."""
    from unittest.mock import MagicMock

    mock_thread = MagicMock(spec=threading.Thread)
    mock_thread.is_alive.return_value = False

    with (
        patch.object(PluginManager, "updater", mock_thread),
        patch.object(PluginManager, "updater_error", None),
    ):
        assert plugins_ready() is True

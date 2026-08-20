# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Shared immutable plugin state and short synchronized state transitions.

``PluginManager`` is the single namespace holding the process-wide plugin catalogue
(``plugins``) and its accumulated in-memory errors (``errors``), both published as
``pyrsistent`` immutable maps so that reads never need to lock. ``PluginManager.lock``
protects only the short field transitions in this module -- reserving/releasing the
single plugin-management operation slot and swapping the map pointers. It must never
be held across pip, import/reload, template ingestion, database access, or a wait on
a future; those all run on the ``ConcurrentPools.PluginManagement`` worker without
this lock, see ``domain.plugin.loading`` and ``domain.plugin.manager``.

``operation_in_progress`` is to guarantee we don't have concurrently running/submitted
operations -- it exists to increase the PluginManagement single-worker guarantee.
It is ``True`` from the moment a startup/update/unload/uninstall operation is accepted
until its managed wrapper completes (successfully or not), and ``False`` otherwise.

``updater_error`` preserves the existing global failure surface: once set, it blocks
any further update/initial-load operation until the process restarts (there is no
implicit retry or reset), but it does not block unload/uninstall, which remain
available to clean up after a failed plugin.

The helpers below are intentionally small and perform no I/O; callers run any
blocking work outside of them and only call in to publish a snapshot or transition
the reservation.
"""

# TODO the updater_error not being None preventing selected operations is odd, we
# should probably persist the error in structured/accessible/granular form, and
# do a smarter decision making / cleaning

# TODO the operation_in_progress feels unrequired and complicating -- maybe we just
# set pending on the pool to 0? The deadlock/corruption scenario during release is
# undesired!

import logging
import threading
from dataclasses import dataclass

from fiab_core.fable import PluginCompositeId
from fiab_core.plugin import Plugin
from pyrsistent import pmap
from pyrsistent.typing import PMap

from forecastbox.domain.plugin.errors import PluginErrors
from forecastbox.utility.concurrency.synchronization import timed_acquire

logger = logging.getLogger(__name__)

_LOCK_TIMEOUT_SHORT = 5.0  # for ops where failure does not render backend useless
_LOCK_TIMEOUT_RELEASE = 20.0  # failing to release operation_in_progress renders backend useless
_LOCK_TIMEOUT_INITIAL = 60.0  # without initial load the backend is useless, we rather have a long one


class PluginManager:
    """Namespace holding the process-wide plugin catalogue and operation state."""

    # this lock guards only field access in this manager, *not* any venv/pip/io ops
    lock: threading.Lock = threading.Lock()
    plugins: PMap[PluginCompositeId, Plugin] = pmap()
    errors: PMap[PluginCompositeId, PluginErrors] = pmap()
    operation_in_progress: bool = False
    updater_error: str | None = None


@dataclass(frozen=True, eq=True, slots=True)
class ReservationResult:
    accepted: bool
    reason: str


def reserve_operation(*, refuse_on_error: bool = True) -> ReservationResult:
    """Attempt to reserve the single plugin-management operation slot.

    Fails if a prior operation is still in progress. If ``refuse_on_error`` is
    True (the default, used by initial-load/update), a previously recorded
    global ``updater_error`` also blocks the reservation. Unload/uninstall pass
    ``refuse_on_error=False`` so they remain available to clean up after a
    failed plugin.
    """
    with timed_acquire(PluginManager.lock, _LOCK_TIMEOUT_SHORT) as acquired:
        if not acquired:
            return ReservationResult(False, "plugin manager state lock could not be acquired")
        if PluginManager.operation_in_progress:
            return ReservationResult(False, "plugin operation is not idle")
        if refuse_on_error and PluginManager.updater_error is not None:
            return ReservationResult(False, f"plugin updater has failed: {PluginManager.updater_error}")
        PluginManager.operation_in_progress = True
        return ReservationResult(True, "")


def release_reservation() -> None:
    """Roll back a reservation without recording completion or an error.

    Used when a normal (non-``updater_error``) submission is rejected
    synchronously after the reservation was already made, e.g. by a saturated
    pool, so that the domain is not left permanently ``running``.
    """
    with timed_acquire(PluginManager.lock, _LOCK_TIMEOUT_RELEASE) as acquired:
        if acquired:
            PluginManager.operation_in_progress = False
        else:
            logger.error("failed to acquire lock to release a plugin operation reservation")
            # NOTE we release unconditionally -- we rather corrupt than deadlock
            PluginManager.operation_in_progress = False


def finish_ok() -> None:
    """Mark the current operation as finished successfully."""
    with timed_acquire(PluginManager.lock, _LOCK_TIMEOUT_RELEASE) as acquired:
        if acquired:
            PluginManager.operation_in_progress = False
        else:
            logger.error("failed to acquire lock to mark a plugin operation as finished")
            # NOTE we release unconditionally -- we rather corrupt than deadlock
            PluginManager.operation_in_progress = False


def finish_with_error(message: str) -> None:
    """Record an unexpected operation failure and mark the operation as finished.

    Best-effort: prefers corrupting the shared field over silently dropping the
    message if the lock cannot be acquired within the short timeout.
    """
    with timed_acquire(PluginManager.lock, _LOCK_TIMEOUT_RELEASE) as acquired:
        if not acquired:
            logger.error("failed to acquire lock to record updater_error")
        # NOTE we release unconditionally -- we rather corrupt than deadlock
        PluginManager.updater_error = message
        PluginManager.operation_in_progress = False


def publish_bulk_snapshot(plugins: dict[PluginCompositeId, Plugin], errors: dict[PluginCompositeId, PluginErrors]) -> bool:
    """Atomically replace the full plugin/errors maps (initial/bulk load)."""
    with timed_acquire(PluginManager.lock, _LOCK_TIMEOUT_INITIAL) as acquired:
        if not acquired:
            return False
        PluginManager.plugins = pmap(plugins)
        PluginManager.errors = pmap(errors)
        return True


def publish_single_snapshot(plugin_id: PluginCompositeId, plugin: Plugin | None, errors: PluginErrors) -> bool:
    """Atomically publish one plugin's load result (single update)."""
    with timed_acquire(PluginManager.lock, _LOCK_TIMEOUT_INITIAL) as acquired:
        if not acquired:
            return False
        if plugin is not None:
            PluginManager.plugins = PluginManager.plugins.set(plugin_id, plugin)
        if errors:
            PluginManager.errors = PluginManager.errors.set(plugin_id, errors)
        elif plugin_id in PluginManager.errors:
            PluginManager.errors = PluginManager.errors.remove(plugin_id)
        return True


def publish_unloaded(plugin_id: PluginCompositeId) -> bool:
    """Remove a plugin's immutable catalogue/error entries (unload/uninstall)."""
    with timed_acquire(PluginManager.lock, _LOCK_TIMEOUT_SHORT) as acquired:
        if not acquired:
            return False
        if plugin_id in PluginManager.plugins:
            PluginManager.plugins = PluginManager.plugins.remove(plugin_id)
        if plugin_id in PluginManager.errors:
            PluginManager.errors = PluginManager.errors.remove(plugin_id)
        return True

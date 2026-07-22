# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import threading

from forecastbox.utility.concurrency.synchronization import timed_acquire


class NoFreePortsException(Exception):
    """Raised when no ports are available in the FreePortsManager pool."""


# TODO utilize more across the codebase
class FreePortsManager:
    """Manages a pool of ports available for assignment to external processes."""

    # NOTE maybe a list would be better, and go cyclically -- should behave better wrt recyclation
    free_ports: set[int] = set(range(19000, 19100))
    lock: threading.Lock = threading.Lock()

    @staticmethod
    def claim_port() -> int:
        """Claim a free port from the pool. Raises NoFreePortsException if no ports are available."""
        # TODO some simple bind test here, loop and return
        with timed_acquire(FreePortsManager.lock, 1) as acquired:
            if not acquired:
                raise TimeoutError("FreePortsManager lock could not be acquired")
            if not FreePortsManager.free_ports:
                raise NoFreePortsException("No free ports available in the pool")
            return FreePortsManager.free_ports.pop()

    @staticmethod
    def release_port(port: int) -> None:
        """Return a port to the pool."""
        with timed_acquire(FreePortsManager.lock, 1) as acquired:
            if not acquired:
                raise TimeoutError("FreePortsManager lock could not be acquired")
            FreePortsManager.free_ports.add(port)

# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Domain exceptions for gateway lifecycle and connectivity."""


class GatewayError(Exception):
    """Base class for gateway domain errors."""


class GatewayManagerNotInitialized(GatewayError):
    """Raised when gateway manager singleton was not initialized."""


class GatewayAlreadyRunning(GatewayError):
    """Raised when attempting to start an already tracked gateway process."""


class GatewayNotRunning(GatewayError):
    """Raised when attempting to stop or use a non-running gateway process."""


class GatewayNotStarted(GatewayError):
    """Raised when status is requested but no process was started yet."""


class GatewayExited(GatewayError):
    """Raised when status is requested and process already exited."""

    def __init__(self, exitcode: int) -> None:
        self.exitcode = exitcode
        super().__init__(f"Gateway exited with code {exitcode}")

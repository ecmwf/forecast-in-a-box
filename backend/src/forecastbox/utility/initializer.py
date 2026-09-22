# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""General purpose ordered start/stop sequencing, intended for use by application lifespans
that need to bring up several independent-ish subsystems in a particular order, and tear them
down again in the reverse order.

See `Initializer` and `Initializers` below.
"""

import inspect
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

logger = logging.getLogger(__name__)

StartStop = Callable[[], "None | Awaitable[None]"]


def noop() -> None:
    """Default no-op implementation for an Initializer's `start` or `stop`, for steps that
    only need one of the two.
    """
    pass


@dataclass
class Initializer:
    """A single named startup/teardown step.

    `start` is invoked during application startup. `stop` is invoked during teardown, but
    only if `start` previously completed without raising. Either callable may be
    synchronous, or return an awaitable -- in which case it is awaited.
    """

    name: str
    start: StartStop = noop
    stop: StartStop = noop


class Initializers:
    """Runs a list of `Initializer` steps in order on `initialize()`, and in reverse order
    on `shutdown()`.

    This object is stateful: it remembers which steps actually started successfully, so
    that a partial failure during `initialize()` is correctly unwound by `shutdown()`,
    starting from the last successful step -- not from the whole list.

    Failure semantics:
    - a failure in `start()` stops `initialize()` from proceeding to the remaining steps,
      and propagates the exception to the caller. The steps that did start successfully are
      still recorded, so a subsequent `shutdown()` call unwinds exactly those.
    - a failure in `stop()` is logged, but does not stop `shutdown()` from proceeding to the
      remaining steps. If any `stop()` failed, `shutdown()` raises an `ExceptionGroup` after
      all steps have been attempted.
    """

    def __init__(self, initializers: list[Initializer]) -> None:
        self.initializers = initializers
        self._started: list[Initializer] = []

    async def initialize(self) -> None:
        for initializer in self.initializers:
            logger.debug(f"starting initializer {initializer.name!r}")
            result = initializer.start()
            if inspect.isawaitable(result):
                await result
            self._started.append(initializer)

    async def shutdown(self) -> None:
        errors: list[Exception] = []
        for initializer in reversed(self._started):
            logger.debug(f"stopping initializer {initializer.name!r}")
            try:
                result = initializer.stop()
                if inspect.isawaitable(result):
                    await result
            except Exception as e:
                logger.exception(f"failed to stop initializer {initializer.name!r}")
                errors.append(e)
        self._started = []
        if errors:
            raise ExceptionGroup("failed to shut down some initializers", errors)

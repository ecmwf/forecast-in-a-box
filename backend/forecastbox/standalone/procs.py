"""Process-related utilities, mostly for non-service mode:
- ChildProcessGroup for gracefully terminating the backend,
- previous_cleanup in case the previous backend instance didnt finish cleanly.
"""

import logging
import os
import signal
from dataclasses import dataclass
from multiprocessing import connection
from multiprocessing.process import BaseProcess as Process
from typing import cast

import psutil

logger = logging.getLogger(__name__)


@dataclass
class ChildProcessGroup:
    procs: list[Process]

    def wait(self):
        if self.procs:  # NOTE wait([]) actually stucks forever
            connection.wait([p.sentinel for p in self.procs])

    def shutdown(self):
        for p in self.procs:
            if p.is_alive():
                # p.interrupt() # TODO after 3.14 add
                os.kill(cast(int, p.pid), signal.SIGINT)
                p.join(3)
            if p.is_alive():
                p.terminate()
                p.join(3)
            if p.is_alive():
                p.kill()
                p.join(3)


def previous_cleanup():
    """Attempts killing all cascade/fiab procesess. To be executed prior to starting,
    to deal with leftovers from previous possibly unclean exit. *Not* to be executed
    when we are in service mode, ie, the system automatically started fiab process
    and we are just launching frontend.
    """
    # NOTE we implement by "was launched from the same executable", which should be
    # the safest given we have fiab-only python. We could filter by name, by user,
    # persits pids, etc, but ultimately those sound less reliable / less safe
    # NOTE this is inherently risky because it kills all descendants of this process!
    # We protect immediate children to not have issues in pytest / resource_tracker,
    # but this method must not be called before any other children are actually created
    self = psutil.Process()
    executable = self.exe()

    def filtering(p: psutil.Process):
        try:
            return p.exe() == executable and p.pid != self.pid and p.ppid() != self.pid
        except (psutil.AccessDenied, psutil.ZombieProcess):
            return False

    processes = [p for p in psutil.process_iter(["pid", "exe", "ppid"]) if filtering(p)]
    for p in processes:
        try:
            logger.warning(f"stopping process {p.pid}, believing it a remnant of previous run")
            p.terminate()
            try:
                p.wait(1.0)
            except psutil.TimeoutExpired:
                p.kill()
                p.wait(1.0)
        except ProcessLookupError:
            # NOTE likely some earlier kill brought this one down too
            pass
        except Exception:
            logger.error("failed to stop {p.pid()} with {repr(e)}, continuing despite that")

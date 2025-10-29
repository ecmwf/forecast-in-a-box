"""Process-related utilities, mostly for non-service mode:
    - ChildProcessGroup for gracefully terminating the backend,
    - previous_cleanup in case the previous backend instance didnt finish cleanly.
"""

import logging
from dataclasses import dataclass
from multiprocessing import Process, connection

import psutil

logger = logging.getLogger(__name__)

@dataclass
class ChildProcessGroup():
    procs: list[Process]

    def wait(self):
        if self.procs: # NOTE wait([]) actually stucks forever
            connection.wait([p.sentinel for p in self.procs])

    def shutdown(self):
        for p in self.procs:
            p.terminate()
            p.join(1)
            p.kill()


def previous_cleanup():
    """Attempts killing all cascade/fiab procesess. To be executed prior to starting,
    to deal with leftovers from previous possibly unclean exit. *Not* to be executed
    when we are in service mode, ie, the system automatically started fiab process
    and we are just launching frontend.
    """
    # NOTE we implement by "was launched from the same executable", which should be
    # the safest given we have fiab-only python. We could filter by name, by user,
    # persits pids, etc, but ultimately those sound less reliable / less safe
    self = psutil.Process()
    executable = self.exe()
    def filtering(p: psutil.Process):
        try:
            return p.exe() == executable and p.pid != self.pid
        except (psutil.AccessDenied, psutil.ZombieProcess):
            return False
    processes = [p for p in psutil.process_iter(['pid', 'exe']) if filtering(p)]
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

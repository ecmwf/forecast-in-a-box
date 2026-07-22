# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import os
import signal
import subprocess
from multiprocessing.process import BaseProcess
from typing import cast


def shutdown_correctly(process: BaseProcess) -> None:
    """Gracefully shut down a multiprocessing BaseProcess: SIGINT -> terminate -> kill."""
    if process.is_alive():
        os.kill(cast(int, process.pid), signal.SIGINT)
        process.join(3)
    if process.is_alive():
        process.terminate()
        process.join(3)
    if process.is_alive():
        process.kill()
        process.join(3)


def shutdown_popen(process: subprocess.Popen[bytes]) -> None:
    """Gracefully shut down a subprocess.Popen (started with start_new_session=True): SIGINT group -> terminate -> kill."""
    if process.poll() is None:
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGINT)
        except (ProcessLookupError, OSError):
            pass
        try:
            process.wait(3)
        except subprocess.TimeoutExpired:
            pass
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(3)
        except subprocess.TimeoutExpired:
            pass
    if process.poll() is None:
        process.kill()
        try:
            process.wait(3)
        except subprocess.TimeoutExpired:
            pass

# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

# TODO move to ecpyutil once that is published

import threading
from contextlib import contextmanager
from typing import Iterator


@contextmanager
def timed_acquire(lock: threading.Lock, timeout: float) -> Iterator[bool]:
    result = lock.acquire(timeout=timeout)
    try:
        yield result
    finally:
        if result:
            lock.release()

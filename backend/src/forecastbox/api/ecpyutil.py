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


"""
Spec:
1/ move this class one level up, ie, forecastbox.ecpyutil
2/ introduce a new decorator here, frozendc, which is @dataclass(frozen=True, eq=True, slots=True). Have a brief docstring there about why is it a good idea and when to use it
3/ identify all occurrences of dataclass in this project, check whether they are safe to utilize the frozendc (no inheritance, no mutation), and replace if yes
4/ extend AGENTS.md with this new class, there is already related-dataclass comment there
"""

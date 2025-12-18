# (C) Copyright 2025- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from functools import lru_cache

from anemoi.inference.checkpoint import Checkpoint


@lru_cache
def open_checkpoint(checkpoint_path: str) -> Checkpoint:
    """Open a checkpoint from the given path."""
    return Checkpoint(checkpoint_path)

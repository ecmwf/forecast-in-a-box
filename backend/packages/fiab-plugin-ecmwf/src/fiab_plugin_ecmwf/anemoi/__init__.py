# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


import logging

LOG = logging.getLogger(__name__)

# Import and expose the block factories
# If the import fails, log an error but do not raise, so that the plugin can still be loaded
try:
    from .blocks import anemoi_source, anemoi_transform
except ImportError as e:
    anemoi_source = None  # type: ignore[assignment]
    anemoi_transform = None  # type: ignore[assignment]

    LOG.error(f"Failed to import Anemoi blocks: {e}")

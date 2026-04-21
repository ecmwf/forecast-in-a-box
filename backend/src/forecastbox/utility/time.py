# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Time and Date related utilities"""

from datetime import datetime, timedelta


def current_time() -> datetime:
    """Return the current time used for scheduling decisions or submit time derivation."""
    # NOTE used by scheduler for scheduling decision, exposed to the users via endpoint
    # *Not* used for internal liveness measurement etc. Primarily to ensure the same timezone
    # etc are being used.
    return datetime.now()

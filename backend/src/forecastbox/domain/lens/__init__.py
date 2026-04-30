# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Manages the Lens domain -- external inspection tools (e.g. skinnyWMS) that clients
can launch against the outputs of individual Runs for interactive visualisation and
exploration.

Does not depend on any other domain, and is not depended on by any other domain.
The association between a Lens instance and a specific Run output is handled
explicitly by the client.
"""

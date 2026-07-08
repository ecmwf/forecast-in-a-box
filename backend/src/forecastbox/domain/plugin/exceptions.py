# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Domain exceptions for the plugin layer.

Raised by domain.plugin.db and domain.plugin.service; translated to
HTTP responses at the router boundary.
"""


class PluginNotFound(Exception):
    """Raised when a requested plugin is not found in the DB and cannot be eg updated"""

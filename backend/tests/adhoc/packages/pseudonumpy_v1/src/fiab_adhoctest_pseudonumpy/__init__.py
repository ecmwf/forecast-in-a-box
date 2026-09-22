# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Tiny local test-only distribution built and installed by backend/tests/adhoc/run_scenarios.py.
Not a real fiab plugin, not published anywhere -- exists solely to exercise
forecastbox.domain.plugin.compatibility.install_plugin_compatibly against a real
uv-managed virtual environment. See backend/tests/adhoc/README.md.
"""

__version__ = "1.0.0"

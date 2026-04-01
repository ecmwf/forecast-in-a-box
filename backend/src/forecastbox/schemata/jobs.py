# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Schemata entry-point for the jobs database.

Exposes ``create_db_and_tables`` so the entrypoint can discover and run it
via automatic schemata iteration without knowing the underlying db module.
"""

from forecastbox.db.jobs import create_db_and_tables as create_db_and_tables

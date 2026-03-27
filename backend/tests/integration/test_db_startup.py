# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import pathlib


def test_dbs_created(backend_client):
    """Verify that databases were created during backend startup."""
    import forecastbox.utility.config

    fiab_root = forecastbox.utility.config.fiab_home
    assert (pathlib.Path(fiab_root) / "user.db").exists(), "user.db was not created on startup"
    assert (pathlib.Path(fiab_root) / "job.db").exists(), "job.db was not created on startup"

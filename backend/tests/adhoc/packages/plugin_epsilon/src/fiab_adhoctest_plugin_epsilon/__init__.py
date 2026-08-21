# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Tiny local test-only distribution built and installed by backend/tests/adhoc/run_scenarios.py.

Unlike the other adhoctest plugins, this one is deliberately never pre-built into the wheelhouse
or pre-seeded into the scratch venv: it exists solely to exercise a *fresh* editable install
performed during a scenario, to prove that forecastbox.utility.pth_activation makes it importable
in the same process without a restart. See backend/tests/adhoc/README.md.
"""

__version__ = "1.0.0"

# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Entrypoints of the backend: the FastAPI app and its lifespan (`app.py`, `initializers.py`),
the launchers (`main.py`, `bootstrap/`), and the plugin warmup (`warmup.py`).

*NOTE* when making changes here, make sure both launchers (`main.py` and `warmup.py`)
are synchronised -- for example, if anything in the backend setup starts relying on
async loop or dispatcher, you need to take appropriate measures in the warmup as it currently
does not (and should not) spin up the loops and pools. This is a notorious source of errors.
"""

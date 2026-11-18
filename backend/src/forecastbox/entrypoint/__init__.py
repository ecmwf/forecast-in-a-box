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

*NOTE* when making changes here, make sure warmup (`entrypoint/warmup.py`, invoked by
`scripts/fiab.sh warmup`) is unaffected. Warmup reuses selected startup steps (schema creation,
provider and hook registration via `register_providers`, catalog and store initialization) but
deliberately runs without the execution runtime: no pools, no event dispatcher, no managed
threads, no FastAPI loop. Any wiring that domain code needs during plugin install/load must
therefore be registered in `register_providers`, which both call, and must not rely on the
dispatcher or pools. Warmup has been broken this way before.
"""

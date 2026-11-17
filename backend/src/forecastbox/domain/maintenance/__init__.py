# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Periodic jobs-database maintenance. Currently a proof of concept: a managed
long-lived thread that periodically (or on admin trigger) runs a read-only
summary query and exposes the result in its status. Real garbage collection
(retention, deletion, cascades) is not implemented yet.

Depends on the Blueprint domain (storage summary query).
Depended on by Admin domain (direct calls from `routes/admin.py`)

Self-invokes via long running thread, registered in the entrypoint.
"""

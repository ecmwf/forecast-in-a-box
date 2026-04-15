# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Manages Experiment domain -- an Experiment is a collection of Runs, possibly growing
over time (such as when the Experiment is a regular cron-based schedule).

Depends on the Blueprint domain (each Experiment has one associated Blueprint).
Depends on the Run domain (Experiments spawn the associated Runs which then persist the association).
Depends on the Glyph domain (Experiments need to utilize Glyphs for scheduling).
Depended on no other domain.
"""

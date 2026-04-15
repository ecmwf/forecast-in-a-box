# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Manages the Blueprint domain -- user-created entities that capture computation intents.
Used to create Runs and Experiments.

Depends on the Glyph domain, to resolve and validate Glyphs.
Dependen on by Run and Experiment domains.
"""

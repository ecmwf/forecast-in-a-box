# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Manages the Run domain -- execution of python workflows using the `cascade`
execution engine, based on a Blueprint.

Depends on Blueprint, Glyph and Plugin domains -- all are used when compiling a Run.
Depended on by Experiment domain (which spawns Runs).
"""

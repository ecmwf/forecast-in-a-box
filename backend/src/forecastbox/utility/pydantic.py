# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Pydantic base model for forecastbox.

Prefer FiabBaseModel over pydantic.BaseModel unless the model requires dynamic field handling.
"""

from pydantic import BaseModel, ConfigDict


class FiabBaseModel(BaseModel):
    """Base pydantic model for forecastbox. Forbids extra fields to catch misconfigured constructors early."""

    model_config = ConfigDict(extra="forbid")

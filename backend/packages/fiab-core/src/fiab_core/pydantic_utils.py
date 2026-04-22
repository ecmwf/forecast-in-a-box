# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Pydantic base model for fiab-core.

Prefer FiabCoreBaseModel over pydantic.BaseModel unless the model requires dynamic field handling.
"""

from pydantic import BaseModel, ConfigDict


class FiabCoreBaseModel(BaseModel):
    """Base pydantic model for fiab-core. Forbids extra fields to catch misconfigured constructors early."""

    model_config = ConfigDict(extra="forbid")

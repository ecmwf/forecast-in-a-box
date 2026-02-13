# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Declarations related to Artifacts such as ML Model Checkpoints.
"""

from typing import Literal

from pydantic import BaseModel, Field

# NOTE we may eventually fine-grain this with like cuda versions or architecture etc, form a hierarchy, etc. Or maybe not and this will be enough.
Platform = Literal["macos", "linux"]

MlModelCheckpointId = str


class MlModelCheckpoint(BaseModel):
    url: str = Field(
        description="Location such as anemoi catalogue or hugging face registry url. Represents the source url, not an url of a local copy"
    )
    display_name: str = Field(description="Utilized by frontend for listing and picking as input in a job")
    display_author: str = Field(description="Utilized by frontend for displaying author")
    display_description: str = Field(description="Additional info about the model")
    comment: str = Field("", description="Additional internal data at the store level")
    disk_size_bytes: int = Field(description="Physical storage footprint of the checkpoint")
    pip_package_constraints: list[str] = Field(
        description="Pip-compatible constraints for requisite python packages such as torch or anemoi-inference"
    )
    supported_platforms: list[Platform] = Field(
        description="Platforms this model has been tested and verified on"
    )  # Question: or negate, ie, 'unsupported'?
    # NOTE this is provisionary -- maybe we'd have a qubed, maybe a qubed<input> template, maybe nothing
    output_characteristics: list[str] = Field(description="List of variables that the model produces")
    input_characteristics: list[str] = Field(
        description="List of config keys that this model exposes"
    )  # Question: do we want key-values, or just keys and the plugins define values?
    # Question: how would we capture memory requirements? May be tricky since technically its a function of config and backend

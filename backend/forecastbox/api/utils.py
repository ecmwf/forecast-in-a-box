# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Utility Functions."""

from pathlib import Path


from forecastbox.config import config


def get_model_path(model: str) -> Path:
    """Get the path to a model."""
    return (Path(config.api.data_path) / model).with_suffix(".ckpt").absolute()

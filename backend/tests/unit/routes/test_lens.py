# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the lens route helpers, focused on the /metadata/* endpoints."""

import pytest
from fastapi.exceptions import HTTPException

from forecastbox.routes import lens as lens_routes


def test_validate_lens_id_accepts_supported() -> None:
    lens_routes._validate_lens_id("skinnyWMS")  # should not raise


def test_validate_lens_id_rejects_unsupported() -> None:
    with pytest.raises(HTTPException) as exc_info:
        lens_routes._validate_lens_id("notALens")
    assert exc_info.value.status_code == 404


def test_supported_lens_ids_matches_lens_name() -> None:
    assert lens_routes.SUPPORTED_LENS_IDS == {"skinnyWMS"}

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


@pytest.mark.asyncio
async def test_stop_lens_maps_unknown_instance_to_404() -> None:
    from forecastbox.domain.lens.manager import LensInstanceId

    with pytest.raises(HTTPException) as exc_info:
        await lens_routes.stop_lens(LensInstanceId("ghost"))
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_start_lens_routes_to_general_pool_as_lens_start(monkeypatch: pytest.MonkeyPatch) -> None:
    from forecastbox.utility.concurrency.manager import execution_manager
    from forecastbox.utility.config import ConcurrentPools

    calls: list[tuple[object, str]] = []

    async def _recording(pool: object, name: object, task: object) -> str:
        calls.append((pool, str(name)))
        return "iid"

    monkeypatch.setattr(lens_routes, "is_skinny_available", True)
    monkeypatch.setattr(execution_manager, "awaitable_submit", _recording)
    assert await lens_routes.start_skinny_wms_endpoint("/x") == "iid"
    assert calls == [(ConcurrentPools.General, "lens.start")]


@pytest.mark.asyncio
async def test_start_lens_missing_path_is_400(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(lens_routes, "is_skinny_available", True)
    with pytest.raises(HTTPException) as exc_info:
        await lens_routes.start_skinny_wms_endpoint("/definitely/not/here")
    assert exc_info.value.status_code == 400

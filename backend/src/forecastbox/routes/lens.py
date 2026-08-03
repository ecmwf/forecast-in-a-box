# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Lens routes — /lens/*. Corresponds to the `domain.lens` domain.

Lenses are external inspection tools (e.g. skinnyWMS) that clients can launch
against Run outputs. Routes cover: start, status, stop, list, and supported lenses.

Also covers `/metadata/*` -- generic, frontend-managed metadata storage attached
to a lens type (e.g. per-lens display preferences). Fully generic and parametrized
by `lens_id`; only the set of currently supported lensIds is validated at request
time.
"""

# TODO currently no authentication here. Add auth and propagate into the manager itself
# TODO currently no log propagation -- consider routing stdout of skinnywms to files, and allow retrieval here via a new route

import json
import logging
import pathlib
from functools import partial
from typing import TYPE_CHECKING, Annotated, Any, Self, cast, get_args

from fastapi import APIRouter, Depends, HTTPException, status

from forecastbox.domain.auth.users import get_auth_context
from forecastbox.domain.lens import metadata_db
from forecastbox.domain.lens.manager import (
    LensInstanceDetail,
    LensInstanceId,
    LensName,
    LensStatus,
    get_status,
    list_instances,
    start_skinny_wms,
    stop_instance,
)
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.concurrency.manager import execution_manager
from forecastbox.utility.concurrency.ports import NoFreePortsException
from forecastbox.utility.pagination import PaginationSpec
from forecastbox.utility.pydantic import FiabBaseModel
from forecastbox.utility.time import value_dt2str

PREFIX = "/api/v1/lens"

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["lens"],
    responses={404: {"description": "Not found"}},
)

#: Maximum size, in bytes, of the JSON-serialized ``metadata_content`` accepted by
#: the lens metadata ``post`` route. Not exposed as a configuration option.
MAX_LENS_METADATA_CONTENT_BYTES = 1 * 1024 * 1024

#: LensIds currently supported by the metadata routes below. Kept in sync with
#: ``LensName`` (the set of lens types the lens-instance manager supports) --
#: the metadata routes are otherwise fully generic and parametrized by lensId.
SUPPORTED_LENS_IDS = set(get_args(LensName))

try:
    if not TYPE_CHECKING:
        import skinnywms

        is_skinny_available = True
    else:
        skinnywms: Any = None
except ModuleNotFoundError:
    is_skinny_available = False


class LensInstanceDetailResponse(FiabBaseModel):
    """API response model for a lens instance detail. Mirrors LensInstanceDetail fields
    to decouple the public contract from internal domain refactoring."""

    lens_instance_id: LensInstanceId
    status: LensStatus
    lens_name: str
    lens_params: dict[str, Any]
    ports: list[int]

    @classmethod
    def from_detail(cls, lens_instance_id: LensInstanceId, detail: LensInstanceDetail) -> Self:
        return cls(
            lens_instance_id=lens_instance_id,
            status=detail.status,
            lens_name=detail.lens_name,
            lens_params=detail.lens_params,
            ports=list(detail.ports),
        )


class SupportedLensDetail(FiabBaseModel):
    name: str
    route: str
    params: dict[str, str]


@router.post("/start/skinnyWMS")
def start_skinny_wms_endpoint(local_path: str) -> LensInstanceId:
    """Start a skinnyWMS lens instance serving data from the given local path."""
    if not is_skinny_available:
        raise HTTPException(status_code=400, detail="SkinnyWMS installation not found")
    try:
        if not pathlib.Path(local_path).exists():
            raise HTTPException(status_code=400, detail="Provided path does not exist")
        return start_skinny_wms(local_path)
    except NoFreePortsException:
        raise HTTPException(status_code=503, detail="No free ports available for a new lens instance")
    except TimeoutError:
        raise HTTPException(status_code=503, detail="Lens manager is busy")


@router.get("/status")
def get_lens_status(lens_instance_id: LensInstanceId) -> LensInstanceDetailResponse:
    """Get the status of a lens instance."""
    try:
        return LensInstanceDetailResponse.from_detail(lens_instance_id, get_status(lens_instance_id))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Lens instance {lens_instance_id!r} not found")


@router.delete("/stop")
def stop_lens(lens_instance_id: LensInstanceId) -> str:
    """Stop and remove a lens instance."""
    try:
        stop_instance(lens_instance_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Lens instance {lens_instance_id!r} not found")
    except TimeoutError:
        raise HTTPException(status_code=503, detail="Lens manager is busy")
    return "ok"


@router.get("/list")
def list_lenses() -> list[LensInstanceDetailResponse]:
    """List all active lens instances with their current status."""
    return [LensInstanceDetailResponse.from_detail(iid, detail) for iid, detail in list_instances()]


@router.get("/supported")
def list_supported_lenses() -> list[SupportedLensDetail]:
    """List all supported lens types with their start route and parameters."""
    supported = []
    if is_skinny_available:
        supported.append(
            SupportedLensDetail(
                name="skinnyWMS",
                route=f"{PREFIX}/start/skinnyWMS",
                params={"local_path": "Absolute path to the data directory or file to serve"},
            )
        )
    return supported


# ---------------------------------------------------------------------------
# Lens Metadata Endpoints
# ---------------------------------------------------------------------------
#
# Generic, frontend-managed metadata storage keyed by (lensId, lensMetadataId).
# Fully generic in implementation; only the set of supported lensIds is
# validated at request time (currently just "skinnyWMS"). `lens_id` is passed
# as a query param (list) or body field (post, delete) rather than a path
# param, per the routes module's no-path-params convention.
#
# Visibility/write rules (mirrors domain.glyphs global glyphs):
#  - admins see and may list all rows for a lensId.
#  - non-admins see their own rows plus any row marked ``public`` (an
#    admin-provided default/template); no server-side merging is performed --
#    the frontend is responsible for combining own + public rows as needed.
#  - post (upsert) always writes the caller's own row.
#  - delete always targets the caller's own row only, regardless of admin status.


def _validate_lens_id(lens_id: str) -> None:
    if lens_id not in SUPPORTED_LENS_IDS:
        raise HTTPException(status_code=404, detail=f"Lens {lens_id!r} is not supported.")


class LensMetadataResponse(FiabBaseModel):
    """Detail of a single lens metadata row, returned by list and post endpoints."""

    lens_id: str
    lens_metadata_id: str
    metadata_content: Any
    public: bool
    created_by: str
    created_at: str
    updated_at: str


class LensMetadataListResponse(FiabBaseModel):
    """Paginated list of lens metadata rows."""

    items: list[LensMetadataResponse]
    total: int
    page: int
    page_size: int


class LensMetadataListFilters(FiabBaseModel):
    """Query-parameter filters for the lens metadata list endpoint."""

    lens_id: str
    lens_metadata_id: str | None = None


class LensMetadataPostRequest(FiabBaseModel):
    """Request body for creating or updating the caller's lens metadata row."""

    lens_id: str
    lens_metadata_id: str
    metadata_content: Any
    public: bool = False


class LensMetadataDeleteRequest(FiabBaseModel):
    """Identifies the caller's own lens metadata row to delete."""

    lens_id: str
    lens_metadata_id: str


def _row_to_metadata_response(row: metadata_db.LensMetadataRecord) -> LensMetadataResponse:
    return LensMetadataResponse(
        lens_id=row.lens_id,
        lens_metadata_id=row.lens_metadata_id,
        metadata_content=row.metadata_content,
        public=row.public,
        created_by=row.created_by,
        created_at=value_dt2str(row.created_at),
        updated_at=value_dt2str(row.updated_at),
    )


@router.get("/metadata/list")
async def list_lens_metadata(
    filters: Annotated[LensMetadataListFilters, Depends()],
    pagination: Annotated[PaginationSpec, Depends()] = PaginationSpec(),
    auth_context: AuthContext = Depends(get_auth_context),
) -> LensMetadataListResponse:
    """List lens metadata rows for ``lens_id`` visible to the caller.

    Admins see all rows. Non-admins see their own rows plus any row marked
    ``public``. When ``lens_metadata_id`` is given, only rows with that exact
    id are returned -- this may still yield more than one row (e.g. the
    caller's own row plus a public row from another user); the frontend is
    responsible for merging these as needed.
    """
    _validate_lens_id(filters.lens_id)
    total = cast(
        int,
        await execution_manager.await_jobs_db(
            "lens_metadata.count",
            partial(metadata_db.count_lens_metadata, filters.lens_id, auth_context, lens_metadata_id=filters.lens_metadata_id),
        ),
    )
    rows = cast(
        list[metadata_db.LensMetadataRecord],
        await execution_manager.await_jobs_db(
            "lens_metadata.list",
            partial(
                metadata_db.list_lens_metadata,
                filters.lens_id,
                auth_context,
                offset=pagination.start(),
                limit=pagination.page_size,
                lens_metadata_id=filters.lens_metadata_id,
            ),
        ),
    )
    return LensMetadataListResponse(
        items=[_row_to_metadata_response(row) for row in rows],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.post("/metadata/post")
async def post_lens_metadata(
    request: LensMetadataPostRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> LensMetadataResponse:
    """Create or update the caller's lens metadata row for ``lens_metadata_id``.

    Always writes the caller's own row -- there is no way to write another
    user's row, admin or not. Returns 413 if the serialized ``metadata_content``
    exceeds ``MAX_LENS_METADATA_CONTENT_BYTES``.
    """
    _validate_lens_id(request.lens_id)
    content_size = len(json.dumps(request.metadata_content).encode("utf-8"))
    if content_size > MAX_LENS_METADATA_CONTENT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"metadata_content exceeds the maximum allowed size of {MAX_LENS_METADATA_CONTENT_BYTES} bytes.",
        )
    row = cast(
        metadata_db.LensMetadataRecord,
        await execution_manager.await_jobs_db(
            "lens_metadata.upsert",
            partial(
                metadata_db.upsert_lens_metadata,
                request.lens_id,
                request.lens_metadata_id,
                request.metadata_content,
                request.public,
                auth_context,
            ),
        ),
    )
    return _row_to_metadata_response(row)


@router.delete("/metadata/delete")
async def delete_lens_metadata(
    request: LensMetadataDeleteRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> None:
    """Delete the caller's own lens metadata row for ``lens_metadata_id``.

    Always scoped to the caller's own row, regardless of admin status. Returns
    404 if the caller has no such row.
    """
    _validate_lens_id(request.lens_id)
    row = cast(
        metadata_db.LensMetadataRecord | None,
        await execution_manager.await_jobs_db(
            "lens_metadata.delete", partial(metadata_db.delete_lens_metadata, request.lens_id, request.lens_metadata_id, auth_context)
        ),
    )
    if row is None:
        raise HTTPException(status_code=404, detail=f"LensMetadata {request.lens_metadata_id!r} not found for lens {request.lens_id!r}.")

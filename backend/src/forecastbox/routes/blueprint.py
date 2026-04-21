# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Blueprint routes — /blueprint/*. Corresponds to the user-managed domain entities:
 - Blueprint, `domain.blueprint`,
 - Glyph, `domain.glyphs`.
Refers to `domain.plugin`, but does not explicitly manage it.

Contains three categories of routes:
 - complete CRUD+list for blueprints,
 - limited CRUD+list for glyphs,
 - building helper routes, which the clients call in sequence before creating a blueprint.

Glyph routes:
 - GET  glyphs/list      — list intrinsic or global glyphs
 - GET  glyphs/functions — list all custom interpolation functions (filters and globals)
 - POST glyphs/global/post  — create or update a global glyph
 - GET  glyphs/global/get   — retrieve a global glyph by id
"""

from typing import Annotated, Literal, cast

from cascade.low.func import assert_never
from fastapi import APIRouter, Depends, status
from fastapi.exceptions import HTTPException
from fiab_core.fable import BlockFactoryCatalogue, BlockInstanceId, PluginBlockFactoryId, PluginCompositeId
from pydantic import BaseModel

from forecastbox.domain.auth.users import get_auth_context
from forecastbox.domain.blueprint import db, service
from forecastbox.domain.blueprint.exceptions import (
    BlueprintAccessDenied,
    BlueprintNotFound,
    BlueprintVersionConflict,
)
from forecastbox.domain.blueprint.service import BlueprintBuilder, BlueprintSaveCommand, BlueprintValidationExpansion
from forecastbox.domain.blueprint.types import BlueprintId
from forecastbox.domain.glyphs import global_db
from forecastbox.domain.glyphs.intrinsic import AvailableIntrinsicGlyphs, get_values_and_examples
from forecastbox.domain.glyphs.jinja_interpolation import get_custom_functions
from forecastbox.domain.glyphs.types import GlobalGlyphId
from forecastbox.domain.plugin.manager import catalogue_view, plugins_ready
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.pagination import PaginationSpec

PREFIX = "/api/v1/blueprint"

router = APIRouter(
    tags=["blueprint"],
    responses={404: {"description": "Not found"}},
)


# ---------------------------------------------------------------------------
# Route-local contracts
# ---------------------------------------------------------------------------


class BlueprintLookup(BaseModel):
    """Identifies a blueprint, optionally pinning a specific version.

    Used as a Depends()-based query-param group on GET endpoints, and as a
    request body on PUT endpoints that target a specific blueprint.
    """

    blueprint_id: BlueprintId
    version: int | None = None


class BlueprintCreateRequest(BaseModel):
    builder: BlueprintBuilder
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] = []
    parent_id: str | None = None


class BlueprintCreateResponse(BaseModel):
    blueprint_id: BlueprintId
    version: int


class BlueprintGetResponse(BaseModel):
    blueprint_id: BlueprintId
    version: int
    builder: BlueprintBuilder
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] = []
    parent_id: str | None = None


class BlueprintListItem(BaseModel):
    blueprint_id: BlueprintId
    version: int
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] | None = None
    source: str | None = None
    created_by: str | None = None


class BlueprintListResponse(BaseModel):
    blueprints: list[BlueprintListItem]
    total: int
    page: int
    page_size: int


class BlueprintUpdateRequest(BaseModel):
    blueprint_id: BlueprintId
    version: int
    builder: BlueprintBuilder
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] = []
    parent_id: str | None = None


class BlueprintUpdateResponse(BaseModel):
    blueprint_id: BlueprintId
    version: int


class BlueprintDeleteRequest(BaseModel):
    blueprint_id: BlueprintId
    version: int


class BlueprintValidationExpansionResponse(BaseModel):
    """HTTP response for blueprint expand — mirrors BlueprintValidationExpansion from the service layer."""

    global_errors: list[str]
    block_errors: dict[BlockInstanceId, list[str]]
    possible_sources: list[PluginBlockFactoryId]
    possible_expansions: dict[BlockInstanceId, list[PluginBlockFactoryId]]
    resolved_configuration_options: dict[BlockInstanceId, dict[str, str]]


class GlyphDetail(BaseModel):
    name: str
    display_name: str
    valueExample: str
    created_by: str


class GlyphListResponse(BaseModel):
    """Paginated list of glyphs, for both intrinsic and global types."""

    glyphs: list[GlyphDetail]
    total: int
    page: int
    page_size: int


class GlobalGlyphPostRequest(BaseModel):
    """Request body for creating or updating a global glyph.

    ``overriddable`` must be omitted (or ``None``) when ``public=False`` and must
    be provided when ``public=True``.  Non-admins may not set ``public=True``.
    """

    key: str
    value: str
    public: bool = False
    overriddable: bool | None = None


class GlobalGlyphResponse(BaseModel):
    """Detail of a single global glyph, returned by get and post endpoints."""

    global_glyph_id: GlobalGlyphId
    key: str
    value: str
    public: bool
    overriddable: bool | None = None
    created_by: str | None = None
    created_at: str
    updated_at: str


class GlobalGlyphLookup(BaseModel):
    """Identifies a global glyph by its stable id."""

    global_glyph_id: GlobalGlyphId


class GlyphFunctionDetail(BaseModel):
    """Description of a single custom function available in glyph expressions."""

    name: str
    description: str
    kind: Literal["filter", "global"]


class GlyphFunctionsResponse(BaseModel):
    """All custom functions (filters and globals) registered in the interpolation environment."""

    functions: list[GlyphFunctionDetail]


@router.post("/create")
async def create_blueprint(
    request: BlueprintCreateRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> BlueprintCreateResponse:
    """Create a new blueprint from a BlueprintBuilder.

    Returns 422 if the builder fails validation (unknown plugins, undefined
    glyphs, config errors, intrinsic glyph key collisions, etc.).
    """
    validation = await service.validate_expand(request.builder, auth_context, validate_only=True)
    if validation.global_errors or validation.block_errors:
        raise HTTPException(
            status_code=422,
            detail={"global_errors": validation.global_errors, "block_errors": validation.block_errors},
        )
    payload = BlueprintSaveCommand(
        builder=request.builder,
        display_name=request.display_name,
        display_description=request.display_description,
        tags=request.tags,
        parent_id=request.parent_id,
    )
    try:
        result = await service.save_builder(auth_context=auth_context, payload=payload, blueprint_id=None)
    except BlueprintNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BlueprintAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    return BlueprintCreateResponse(blueprint_id=result.blueprint_id, version=result.blueprint_version)


@router.get("/get")
async def get_blueprint(
    spec: Annotated[BlueprintLookup, Depends()],
) -> BlueprintGetResponse:
    """Retrieve a saved blueprint by id and optional version.

    Returns the latest non-deleted version when version is omitted.
    """
    try:
        retrieved = await service.load_builder(spec.blueprint_id, spec.version)
    except BlueprintNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return BlueprintGetResponse(
        blueprint_id=retrieved.blueprint_id,
        version=retrieved.blueprint_version,
        builder=retrieved.builder,
        display_name=retrieved.display_name,
        display_description=retrieved.display_description,
        tags=retrieved.tags,
        parent_id=retrieved.parent_id,
    )


@router.get("/list")
async def list_blueprints(
    pagination: Annotated[PaginationSpec, Depends()],
    auth_context: AuthContext = Depends(get_auth_context),
) -> BlueprintListResponse:
    """List the latest non-deleted version of every blueprint visible to the caller."""
    total = await db.count_blueprints(auth_context=auth_context)
    start = pagination.start()
    page_defs = list(await db.list_blueprints(auth_context=auth_context, offset=start, limit=pagination.page_size))
    items = [
        BlueprintListItem(
            blueprint_id=BlueprintId(str(defn.blueprint_id)),  # ty:ignore[invalid-argument-type]
            version=cast(int, defn.version),
            display_name=cast(str | None, defn.display_name),
            display_description=cast(str | None, defn.display_description),
            tags=cast(list[str] | None, defn.tags),
            source=cast(str | None, defn.source),
            created_by=cast(str | None, defn.created_by),
        )
        for defn in page_defs
    ]
    return BlueprintListResponse(blueprints=items, total=total, page=pagination.page, page_size=pagination.page_size)


@router.post("/update")
async def update_blueprint(
    request: BlueprintUpdateRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> BlueprintUpdateResponse:
    """Add a new version to an existing blueprint.

    ``version`` must match the current latest version; returns 409 if it does not.
    Returns 422 if the builder fails validation (unknown plugins, undefined
    glyphs, config errors, intrinsic glyph key collisions, etc.).
    Returns the new version number on success.
    """
    validation = await service.validate_expand(request.builder, auth_context, validate_only=True)
    if validation.global_errors or validation.block_errors:
        raise HTTPException(
            status_code=422,
            detail={"global_errors": validation.global_errors, "block_errors": validation.block_errors},
        )
    payload = BlueprintSaveCommand(
        builder=request.builder,
        display_name=request.display_name,
        display_description=request.display_description,
        tags=request.tags,
        parent_id=request.parent_id,
    )
    try:
        result = await service.save_builder(
            auth_context=auth_context,
            payload=payload,
            blueprint_id=request.blueprint_id,
            expected_version=request.version,
        )
    except BlueprintVersionConflict as e:
        raise HTTPException(status_code=409, detail=str(e))
    except BlueprintNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BlueprintAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    return BlueprintUpdateResponse(blueprint_id=result.blueprint_id, version=result.blueprint_version)


@router.post("/delete")
async def delete_blueprint(
    request: BlueprintDeleteRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> None:
    """Soft-delete all versions of a blueprint.

    ``version`` must match the current latest version; returns 409 if it does not.
    """
    try:
        await db.soft_delete_blueprint(
            request.blueprint_id,
            expected_version=request.version,
            auth_context=auth_context,
        )
    except BlueprintVersionConflict as e:
        raise HTTPException(status_code=409, detail=str(e))
    except BlueprintNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BlueprintAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))


# ---------------------------------------------------------------------------
# Building helpers
# ---------------------------------------------------------------------------


@router.get("/catalogue")
def get_catalogue() -> dict[PluginCompositeId, BlockFactoryCatalogue]:
    """All blocks this backend is capable of evaluating within a blueprint."""
    if not plugins_ready():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Plugins not ready")
    catalogue = catalogue_view()
    if isinstance(catalogue, bool):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Plugins not ready")
    return catalogue


@router.put("/expand")
async def expand_blueprint(
    blueprint: BlueprintBuilder,
    auth_context: AuthContext = Depends(get_auth_context),
) -> BlueprintValidationExpansionResponse:
    """Validate a partially-constructed BlueprintBuilder and return completion options.

    Returns 200 regardless of whether validation errors are present; callers must
    inspect the returned error fields.
    """
    result = await service.validate_expand(blueprint, auth_context, validate_only=False)
    return BlueprintValidationExpansionResponse(
        global_errors=result.global_errors,
        block_errors=result.block_errors,
        possible_sources=result.possible_sources,
        possible_expansions=result.possible_expansions,
        resolved_configuration_options=result.resolved_configuration_options,
    )


# ---------------------------------------------------------------------------
# Glyph CRUD+List Endpoints
# ---------------------------------------------------------------------------


@router.get("/glyphs/list")
async def list_available_glyphs(
    glyph_type: Literal["intrinsic", "global"] = "intrinsic",
    pagination: Annotated[PaginationSpec, Depends()] = PaginationSpec(),
    auth_context: AuthContext = Depends(get_auth_context),
) -> GlyphListResponse:
    """List available glyphs.

    When ``glyph_type`` is ``intrinsic``, returns the fixed set of system-provided
    glyphs; pagination params are ignored.  When ``glyph_type`` is ``global``,
    returns user-defined glyphs visible to the caller with paging applied.
    """
    if glyph_type == "intrinsic":
        glyphs: list[GlyphDetail] = []
        for glyph_name, example in get_values_and_examples().items():
            glyph: AvailableIntrinsicGlyphs = glyph_name
            if glyph == "runId":
                display_name = "Run ID"
            elif glyph == "submitDatetime":
                display_name = "Submit Datetime (fixed at first submission, preserved on restart)"
            elif glyph == "startDatetime":
                display_name = "Start Datetime (updated on every restart)"
            elif glyph == "attemptCount":
                display_name = "Attempt Count (incremented on every restart)"
            else:
                assert_never(glyph)
            glyphs.append(GlyphDetail(name=glyph_name, display_name=display_name, valueExample=example, created_by="intrinsic"))
        return GlyphListResponse(glyphs=glyphs, total=len(glyphs), page=1, page_size=len(glyphs))
    else:
        total = await global_db.count_global_glyphs(auth_context)
        start = pagination.start()
        rows = list(await global_db.list_global_glyphs(auth_context, offset=start, limit=pagination.page_size))
        glyphs_global = [
            GlyphDetail(
                name=str(row.key),
                display_name=str(row.key),
                valueExample=str(row.value),
                created_by=str(row.created_by) if row.created_by is not None else "",
            )
            for row in rows
        ]
        return GlyphListResponse(glyphs=glyphs_global, total=total, page=pagination.page, page_size=pagination.page_size)


@router.get("/glyphs/functions")
def list_glyph_functions() -> GlyphFunctionsResponse:
    """Return all custom functions available in glyph interpolation expressions.

    Includes both filters (pipe syntax, e.g. ``${dt | add_days(1)}``) and globals
    (direct call syntax, e.g. ``${timedelta(days=1)}``).
    """
    return GlyphFunctionsResponse(
        functions=[GlyphFunctionDetail(name=fn.name, description=fn.description, kind=fn.kind) for fn in get_custom_functions()]
    )


@router.post("/glyphs/global/post")
async def post_global_glyph(
    request: GlobalGlyphPostRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> GlobalGlyphResponse:
    """Create or update a global glyph by key.

    Returns 422 if the key collides with any intrinsic glyph name, or if
    ``overriddable`` is inconsistent with ``public`` (must be set when public=True,
    must be absent when public=False).
    Returns 403 if a non-admin tries to create a public glyph.
    """
    intrinsic_names = set(get_values_and_examples().keys())
    if request.key in intrinsic_names:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Key {request.key!r} is reserved as an intrinsic glyph and cannot be overridden.",
        )
    if request.public and request.overriddable is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="overriddable must be specified when public=True.",
        )
    if not request.public and request.overriddable is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="overriddable must not be specified when public=False.",
        )
    if request.public and not auth_context.has_admin():
        raise HTTPException(
            status_code=403,
            detail="Only admins may create or update public global glyphs.",
        )
    row = await global_db.upsert_global_glyph(request.key, request.value, request.public, request.overriddable, auth_context)
    return GlobalGlyphResponse(
        global_glyph_id=GlobalGlyphId(str(row.global_glyph_id)),  # ty:ignore[invalid-argument-type]
        key=str(row.key),
        value=str(row.value),
        public=bool(row.public),
        overriddable=bool(row.overriddable) if row.overriddable is not None else None,
        created_by=str(row.created_by) if row.created_by is not None else None,
        created_at=str(row.created_at),
        updated_at=str(row.updated_at),
    )


@router.get("/glyphs/global/get")
async def get_global_glyph(
    spec: Annotated[GlobalGlyphLookup, Depends()],
    auth_context: AuthContext = Depends(get_auth_context),
) -> GlobalGlyphResponse:
    """Retrieve a global glyph visible to the caller by its stable id."""
    row = await global_db.get_global_glyph(spec.global_glyph_id, auth_context)
    if row is None:
        raise HTTPException(status_code=404, detail=f"GlobalGlyph {spec.global_glyph_id!r} not found.")
    return GlobalGlyphResponse(
        global_glyph_id=GlobalGlyphId(str(row.global_glyph_id)),  # ty:ignore[invalid-argument-type]
        key=str(row.key),
        value=str(row.value),
        public=bool(row.public),
        overriddable=bool(row.overriddable) if row.overriddable is not None else None,
        created_by=str(row.created_by) if row.created_by is not None else None,
        created_at=str(row.created_at),
        updated_at=str(row.updated_at),
    )

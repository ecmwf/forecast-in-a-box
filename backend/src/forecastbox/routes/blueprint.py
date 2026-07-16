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
 - GET  glyphs/list      — list glyphs with optional type/key filters; returns combined intrinsic+global
 - GET  glyphs/functions — list all custom interpolation functions (filters and globals)
 - POST glyphs/global/post    — create or update a global glyph
 - POST glyphs/global/delete  — delete a global glyph by id
"""

import datetime as dt
import logging
from typing import Annotated, Any, Literal, cast

from cascade.low.func import assert_never
from fastapi import APIRouter, Depends, status
from fastapi.exceptions import HTTPException
from fiab_core.fable import (
    BlockFactoryCatalogue,
    BlockInstanceId,
    ConfigurationOptionId,
    PluginCompositeId,
)

from forecastbox.domain.auth.users import get_auth_context
from forecastbox.domain.blueprint import db, service
from forecastbox.domain.blueprint.exceptions import (
    BlueprintAccessDenied,
    BlueprintNotFound,
    BlueprintVersionConflict,
)
from forecastbox.domain.blueprint.service import (
    BlueprintBuilder,
    BlueprintSaveCommand,
    BlueprintValidationExpansion,
    PluginBlockFactoryId,
    SerializedBlockExpansion,
    Tag,
)
from forecastbox.domain.blueprint.types import BlueprintId
from forecastbox.domain.glyphs import global_db
from forecastbox.domain.glyphs.intrinsic import AvailableIntrinsicGlyphs, get_values_and_examples
from forecastbox.domain.glyphs.jinja_interpolation import get_custom_functions
from forecastbox.domain.glyphs.types import GlobalGlyphId
from forecastbox.domain.plugin.compatibility import get_fiabcore_version
from forecastbox.domain.plugin.manager import catalogue_view, plugins_ready
from forecastbox.schemata.jobs import BlueprintSource, GlobalGlyph
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.pagination import PaginationSpec
from forecastbox.utility.pydantic import FiabBaseModel
from forecastbox.utility.time import value_dt2str

logger = logging.getLogger(__name__)
PREFIX = "/api/v1/blueprint"

router = APIRouter(
    tags=["blueprint"],
    responses={404: {"description": "Not found"}},
)

_CORE_VERSION_MISMATCH_KEY = "CoreVersionMismatch"


def _maybe_append_coreversion_mismatch(tags: list[Tag], entity_coreversion: int, current_coreversion: int) -> None:
    """Append a ``CoreVersionMismatch`` tag when the stored and current fiab-core major versions differ."""
    if entity_coreversion != current_coreversion:
        tags.append(Tag(key=_CORE_VERSION_MISMATCH_KEY, value=f"!{entity_coreversion} != {current_coreversion}"))


def _reject_reserved_tags(tags: list[Tag]) -> None:
    """Raise HTTP 422 if any tag uses a key reserved for system use."""
    if any(t.key == _CORE_VERSION_MISMATCH_KEY for t in tags):
        raise HTTPException(
            status_code=422,
            detail=f"Tag key {_CORE_VERSION_MISMATCH_KEY!r} is reserved and may not be set by callers.",
        )


# ---------------------------------------------------------------------------
# Route-local contracts
# ---------------------------------------------------------------------------


class BlueprintLookup(FiabBaseModel):
    """Identifies a blueprint, optionally pinning a specific version.

    Used as a Depends()-based query-param group on GET endpoints, and as a
    request body on PUT endpoints that target a specific blueprint.
    """

    blueprint_id: BlueprintId
    version: int | None = None


class BlueprintCreateRequest(FiabBaseModel):
    builder: BlueprintBuilder
    display_name: str | None = None
    display_description: str | None = None
    tags: list[Tag] = []
    parent_id: str | None = None


class BlueprintCreateResponse(FiabBaseModel):
    blueprint_id: BlueprintId
    version: int


class BlueprintGetResponse(FiabBaseModel):
    blueprint_id: BlueprintId
    version: int
    builder: BlueprintBuilder
    display_name: str | None = None
    display_description: str | None = None
    tags: list[Tag] = []
    parent_id: str | None = None
    created_at: str
    updated_at: str
    user: str


class BlueprintListItem(FiabBaseModel):
    blueprint_id: BlueprintId
    version: int
    display_name: str | None = None
    display_description: str | None = None
    tags: list[Tag] | None = None
    source: str | None = None
    created_at: str
    updated_at: str
    user: str | None = None


class BlueprintListFilters(FiabBaseModel):
    """Optional query-parameter filters for the blueprint list endpoint."""

    created_by: str | None = None
    source: BlueprintSource | None = None


class BlueprintListResponse(FiabBaseModel):
    blueprints: list[BlueprintListItem]
    total: int
    page: int
    page_size: int


class BlueprintUpdateRequest(FiabBaseModel):
    blueprint_id: BlueprintId
    version: int
    builder: BlueprintBuilder
    display_name: str | None = None
    display_description: str | None = None
    tags: list[Tag] = []
    parent_id: str | None = None


class BlueprintUpdateResponse(FiabBaseModel):
    blueprint_id: BlueprintId
    version: int


class BlueprintDeleteRequest(FiabBaseModel):
    blueprint_id: BlueprintId
    version: int


class BlueprintValidationExpansionResponse(FiabBaseModel):
    """HTTP response for blueprint expand — mirrors BlueprintValidationExpansion from the service layer."""

    global_errors: list[str]
    block_errors: dict[BlockInstanceId, list[str]]
    possible_sources: list[PluginBlockFactoryId]
    possible_expansions: dict[BlockInstanceId, list[SerializedBlockExpansion]]
    configuration_restrictions: dict[BlockInstanceId, dict[ConfigurationOptionId, str]] = {}
    resolved_configuration_options: dict[BlockInstanceId, dict[ConfigurationOptionId, str]]
    missing_glyphs: dict[BlockInstanceId, dict[ConfigurationOptionId, list[str]]] = {}
    block_output_qubes: dict[BlockInstanceId, dict[str, Any]] = {}


GlyphType = Literal["intrinsic", "global"]


class IntrinsicGlyphResponse(FiabBaseModel):
    """Detail of a single intrinsic (system-provided) glyph."""

    glyph_type: GlyphType = "intrinsic"
    name: str
    display_name: str
    valueExample: str
    created_by: str


class GlobalGlyphPostRequest(FiabBaseModel):
    """Request body for creating or updating a global glyph.

    ``overriddable`` must be omitted (or ``None``) when ``public=False`` and must
    be provided when ``public=True``.  Non-admins may not set ``public=True``.
    """

    key: str
    value: str
    public: bool = False
    overriddable: bool | None = None


class GlobalGlyphResponse(FiabBaseModel):
    """Detail of a single global glyph, returned by post and list endpoints."""

    glyph_type: GlyphType = "global"
    global_glyph_id: GlobalGlyphId
    key: str
    value: str
    public: bool
    overriddable: bool | None = None
    created_by: str
    created_at: str
    updated_at: str


class GlyphListResponse(FiabBaseModel):
    """Paginated list of glyphs, combining intrinsic and global types."""

    glyphs: list[GlobalGlyphResponse | IntrinsicGlyphResponse]
    total: int
    page: int
    page_size: int


class GlobalGlyphLookup(FiabBaseModel):
    """Identifies a global glyph by its stable id."""

    global_glyph_id: GlobalGlyphId


class GlyphFunctionDetail(FiabBaseModel):
    """Description of a single custom function available in glyph expressions."""

    name: str
    description: str
    kind: Literal["filter", "global"]


class GlyphFunctionsResponse(FiabBaseModel):
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
    Returns 422 if any of the supplied tags has a reserved key.
    """
    _reject_reserved_tags(request.tags)
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
    tags = list(retrieved.tags)
    _maybe_append_coreversion_mismatch(tags, retrieved.fiabcore_major, get_fiabcore_version().major)
    return BlueprintGetResponse(
        blueprint_id=retrieved.blueprint_id,
        version=retrieved.blueprint_version,
        builder=retrieved.builder,
        display_name=retrieved.display_name,
        display_description=retrieved.display_description,
        tags=tags,
        parent_id=retrieved.parent_id,
        created_at=retrieved.created_at,
        updated_at=retrieved.updated_at,
        user=retrieved.user,
    )


@router.get("/list")
async def list_blueprints(
    pagination: Annotated[PaginationSpec, Depends()],
    filters: Annotated[BlueprintListFilters, Depends()],
    auth_context: AuthContext = Depends(get_auth_context),
) -> BlueprintListResponse:
    """List the latest non-deleted version of every blueprint visible to the caller.

    Optional query parameters:
    - ``created_by``: restrict to blueprints owned by this user or plugin.
    - ``source``: restrict to blueprints with this source (``plugin_template``,
      ``user_defined``, or ``oneoff_execution``).  Returns 422 for unknown values.
    """
    total = await db.count_blueprints(auth_context=auth_context, created_by=filters.created_by, source=filters.source)
    start = pagination.start()
    page_defs = list(
        await db.list_blueprints(
            auth_context=auth_context,
            offset=start,
            limit=pagination.page_size,
            created_by=filters.created_by,
            source=filters.source,
        )
    )
    current_fiabcore_major = get_fiabcore_version().major
    items = []
    for row in page_defs:
        defn = row.blueprint
        raw_tags: list[dict] = cast(list[dict], defn.tags) or []
        tags = [Tag.model_validate(t) for t in raw_tags]
        _maybe_append_coreversion_mismatch(tags, cast(int, defn.fiabcore_major), current_fiabcore_major)
        items.append(
            BlueprintListItem(
                blueprint_id=BlueprintId(str(defn.blueprint_id)),  # ty:ignore[invalid-argument-type]
                version=cast(int, defn.version),
                display_name=cast(str | None, defn.display_name),
                display_description=cast(str | None, defn.display_description),
                tags=tags,
                source=cast(str | None, defn.source),
                created_at=value_dt2str(row.created_at),
                updated_at=value_dt2str(cast(dt.datetime, defn.created_at)),
                user=cast(str | None, defn.created_by),
            )
        )
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
    Returns 422 if any of the supplied tags has a reserved key.
    Returns the new version number on success.
    """
    _reject_reserved_tags(request.tags)
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
        configuration_restrictions=result.configuration_restrictions,
        resolved_configuration_options=result.resolved_configuration_options,
        missing_glyphs=result.missing_glyphs,
        block_output_qubes=result.block_output_qubes,
    )


# ---------------------------------------------------------------------------
# Glyph CRUD+List Endpoints
# ---------------------------------------------------------------------------


def _build_intrinsic_glyphs(glyph_key: str | None) -> list[IntrinsicGlyphResponse]:
    """Return all intrinsic glyphs, optionally filtered by exact key match."""
    result: list[IntrinsicGlyphResponse] = []
    for glyph_name, example in get_values_and_examples().items():
        if glyph_key is not None and glyph_name != glyph_key:
            continue
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
        result.append(IntrinsicGlyphResponse(name=glyph_name, display_name=display_name, valueExample=example, created_by="intrinsic"))
    return result


def _row_to_global_response(row: GlobalGlyph) -> GlobalGlyphResponse:
    return GlobalGlyphResponse(
        global_glyph_id=GlobalGlyphId(str(row.global_glyph_id)),  # ty:ignore[invalid-argument-type]
        key=str(row.key),
        value=str(row.value),
        public=bool(row.public),
        overriddable=bool(row.overriddable) if row.overriddable is not None else None,
        created_by=str(row.created_by),
        created_at=str(row.created_at),
        updated_at=str(row.updated_at),
    )


@router.get("/glyphs/list")
async def list_available_glyphs(
    glyph_type: GlyphType | None = None,
    glyph_key: str | None = None,
    pagination: Annotated[PaginationSpec, Depends()] = PaginationSpec(),
    auth_context: AuthContext = Depends(get_auth_context),
) -> GlyphListResponse:
    """List available glyphs with optional filtering.

    ``glyph_type`` may be ``intrinsic``, ``global``, or omitted (returns both).
    ``glyph_key`` filters to glyphs whose key exactly matches the given value.

    Results are ordered: all matching intrinsic glyphs first (ordered by key),
    then matching global glyphs (ordered by key).  Pagination is applied across
    the combined result set.
    """
    want_intrinsic = glyph_type is None or glyph_type == "intrinsic"
    want_global = glyph_type is None or glyph_type == "global"

    # Always compute all matching intrinsic glyphs (there are always few).
    intrinsic_all = _build_intrinsic_glyphs(glyph_key) if want_intrinsic else []
    intrinsic_page, remainder = pagination.extract_and_shift(intrinsic_all)

    global_items: list[GlobalGlyphResponse] = []
    global_total = 0
    if want_global:
        global_total = await global_db.count_global_glyphs(auth_context, key=glyph_key)
        if remainder.current_page_remaining > 0:
            rows = list(
                await global_db.list_global_glyphs(
                    auth_context, offset=remainder.offset_shifted, limit=remainder.current_page_remaining, key=glyph_key
                )
            )
            global_items = [_row_to_global_response(row) for row in rows]

    combined: list[GlobalGlyphResponse | IntrinsicGlyphResponse] = [*intrinsic_page, *global_items]
    total = len(intrinsic_all) + global_total
    return GlyphListResponse(glyphs=combined, total=total, page=pagination.page, page_size=pagination.page_size)


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
    return _row_to_global_response(row)


@router.post("/glyphs/global/delete")
async def delete_global_glyph(
    request: GlobalGlyphLookup,
    auth_context: AuthContext = Depends(get_auth_context),
) -> None:
    """Delete a global glyph by its stable id.

    Returns 404 if the glyph does not exist or is not visible to the caller.
    Returns 403 if the caller is not the owner and is not an admin.
    """
    row = await global_db.delete_global_glyph(request.global_glyph_id, auth_context)
    if row is None:
        raise HTTPException(status_code=404, detail=f"GlobalGlyph {request.global_glyph_id!r} not found or not accessible.")

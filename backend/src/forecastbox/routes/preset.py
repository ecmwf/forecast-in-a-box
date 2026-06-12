# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Preset routes — /api/v1/presets/*. Corresponds to the user-managed domain entity:
 - HighLevelPreset, `domain.preset`.

Routes:
 - complete CRUD+list for presets (create, get, list, update, delete),
 - an instantiate route that materialises a preset template with user-supplied
   parameter values and optionally saves a blueprint and submits a run.

Route summary:
 - GET  /list        — paginated list of presets (summary fields + builder_template; no parameters)
 - GET  /get         — full preset detail including builder_template and parameters
 - POST /create      — create a new preset
 - POST /update      — add a new version to an existing preset (optimistic lock via version)
 - POST /delete      — soft-delete all versions of a preset (optimistic lock via version)
 - POST /instantiate — materialise a preset and optionally submit a run
"""

import asyncio
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends
from fastapi.exceptions import HTTPException
from fiab_core.presets import PluginPresetDefinition

from forecastbox.domain.auth.users import get_auth_context
from forecastbox.domain.blueprint.service import BlueprintBuilder
from forecastbox.domain.blueprint.types import BlueprintId
from forecastbox.domain.preset import db, service
from forecastbox.domain.preset.exceptions import (
    PresetAccessDenied,
    PresetInstantiationValidationError,
    PresetNotFound,
    PresetVersionConflict,
)
from forecastbox.domain.preset.plugin_presets import (
    convert_to_builder,
    find_plugin_preset,
    get_all_plugin_presets,
)
from forecastbox.domain.preset.types import PresetId
from forecastbox.domain.preset.value_type_resolver import resolve_value_type
from forecastbox.domain.run.types import RunId
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.pagination import PaginationSpec
from forecastbox.utility.pydantic import FiabBaseModel

PREFIX = "/api/v1/presets"

router = APIRouter(
    tags=["presets"],
    responses={404: {"description": "Not found"}},
)


# ---------------------------------------------------------------------------
# Route-local contracts
# ---------------------------------------------------------------------------


class PresetLookup(FiabBaseModel):
    """Identifies a preset, optionally pinning a specific version.

    Used as a Depends()-based query-param group on GET endpoints, and as a
    request body field on endpoints that address a specific preset.
    """

    preset_id: PresetId
    version: int | None = None


PresetDifficultyLiteral = Literal["beginner", "intermediate", "advanced"]
"""Difficulty level for a preset, expressed as a Literal for stable contract serialisation."""

PresetSourceLiteral = Literal["plugin", "user"]
"""Origin of a preset: ``"plugin"`` for plugin-provided presets, ``"user"`` for DB-backed presets."""


class PresetParameterContract(FiabBaseModel):
    """A single user-facing parameter exposed by a preset.

    Route-local mirror of ``domain.preset.models.PresetParameter``; kept
    separate so internal refactoring cannot silently change the API contract.
    """

    glyph_key: str
    label: str
    description: str
    value_type: str
    """FableType string (e.g. ``"string"``, ``"integer"``, ``"enum"``)."""
    default_value: str


class PresetListItem(FiabBaseModel):
    """Summary representation of a preset, returned by the list endpoint.

    Includes ``builder_template`` so the gallery can render a mini block preview
    on each card without an additional round-trip per preset. ``parameters`` is
    still omitted; use the /get endpoint to retrieve those.
    """

    preset_id: PresetId
    version: int
    name: str
    description: str
    difficulty: PresetDifficultyLiteral
    tags: list[str] = []
    icon: str
    source: PresetSourceLiteral
    plugin_id: str | None = None
    builder_template: BlueprintBuilder
    is_published: bool
    created_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class PresetListResponse(FiabBaseModel):
    """Paginated list of preset summaries."""

    presets: list[PresetListItem]
    total: int
    page: int
    page_size: int


class PresetGetResponse(FiabBaseModel):
    """Full preset detail, including the builder template and parameters."""

    preset_id: PresetId
    version: int
    name: str
    description: str
    long_description: str | None = None
    difficulty: PresetDifficultyLiteral
    tags: list[str] = []
    icon: str
    source: PresetSourceLiteral
    plugin_id: str | None = None
    # NOTE: BlueprintBuilder is used directly here — it is an explicitly marked
    # exception to the route-local contract rule (see routes/__init__.py).
    builder_template: BlueprintBuilder
    parameters: list[PresetParameterContract] = []
    is_published: bool
    created_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class PresetCreateRequest(FiabBaseModel):
    """All fields required to create a new preset."""

    name: str
    description: str
    long_description: str | None = None
    difficulty: PresetDifficultyLiteral
    tags: list[str] = []
    icon: str = "Cloud"
    # NOTE: BlueprintBuilder is used directly here — explicitly marked exception.
    builder_template: BlueprintBuilder
    parameters: list[PresetParameterContract] = []
    is_published: bool = False


class PresetCreateResponse(FiabBaseModel):
    """Returned after successfully creating a preset."""

    preset_id: PresetId
    version: int


class PresetUpdateRequest(FiabBaseModel):
    """All fields required to update an existing preset.

    ``version`` is the current latest version and acts as an optimistic
    concurrency lock; the request is rejected with 409 if it does not match.
    """

    preset_id: PresetId
    version: int
    name: str
    description: str
    long_description: str | None = None
    difficulty: PresetDifficultyLiteral
    tags: list[str] = []
    icon: str = "Cloud"
    # NOTE: BlueprintBuilder is used directly here — explicitly marked exception.
    builder_template: BlueprintBuilder
    parameters: list[PresetParameterContract] = []
    is_published: bool = False


class PresetUpdateResponse(FiabBaseModel):
    """Returned after successfully updating a preset (new version number)."""

    preset_id: PresetId
    version: int


class PresetDeleteRequest(FiabBaseModel):
    """Identifies the preset to soft-delete.

    ``version`` must match the current latest version to prevent races.
    """

    preset_id: PresetId
    version: int


class PresetPublishRequest(FiabBaseModel):
    """Request body for toggling the publish status of a preset in place.

    Unlike ``/update``, this endpoint mutates the existing row without creating
    a new version.  ``version`` acts as an optimistic concurrency lock.
    """

    preset_id: PresetId
    version: int
    is_published: bool


class PresetInstantiateRequest(FiabBaseModel):
    """Request body for instantiating a preset with user-supplied parameter values.

    ``parameter_values`` maps glyph keys to string values; keys absent from the
    map fall back to each parameter's ``default_value``.

    ``auto_run`` controls whether a run is submitted immediately after saving the
    blueprint (``True``, the default) or whether only the blueprint is saved and
    returned for the caller to open in the editor (``False``).
    """

    preset_id: PresetId
    parameter_values: dict[str, str] = {}
    auto_run: bool = True


class PresetInstantiateResponse(FiabBaseModel):
    """Result of instantiating a preset.

    When ``auto_run=True`` (the default) ``blueprint_id``, ``blueprint_version``,
    ``run_id``, and ``attempt_count`` are all populated.  When ``auto_run=False``
    no persistence happens server-side; the caller receives only the
    materialised ``builder`` and is expected to open it in the editor and save
    it explicitly.  In that case ``blueprint_id``, ``blueprint_version``,
    ``run_id``, and ``attempt_count`` are all ``None``.

    NOTE: BlueprintBuilder is used directly here — explicitly marked exception.
    """

    builder: BlueprintBuilder
    blueprint_id: BlueprintId | None = None
    blueprint_version: int | None = None
    run_id: RunId | None = None
    attempt_count: int | None = None


# ---------------------------------------------------------------------------
# Plugin-preset conversion helpers
# ---------------------------------------------------------------------------


def _plugin_preset_to_list_item(preset_def: PluginPresetDefinition, *, plugin_id: str) -> PresetListItem:
    """Convert a :class:`~fiab_core.presets.PluginPresetDefinition` to a
    :class:`PresetListItem` suitable for the list endpoint response.

    Plugin presets are always treated as published (``is_published=True``) and
    have no database-backed ownership metadata (``created_by``, ``created_at``,
    ``updated_at`` are all ``None``).  Version is fixed at ``1`` since plugin
    presets are immutable from the API's perspective.
    """
    builder = BlueprintBuilder(blocks=dict(preset_def.blocks))
    return PresetListItem(
        preset_id=PresetId(preset_def.preset_id),
        version=1,
        name=preset_def.name,
        description=preset_def.description,
        difficulty=cast(PresetDifficultyLiteral, preset_def.difficulty),
        tags=list(preset_def.tags),
        icon=preset_def.icon,
        source="plugin",
        plugin_id=plugin_id,
        builder_template=builder,
        is_published=True,
        created_by=None,
        created_at=None,
        updated_at=None,
    )


async def _plugin_preset_to_get_response(preset_def: PluginPresetDefinition, *, plugin_id: str) -> PresetGetResponse:
    """Convert a :class:`~fiab_core.presets.PluginPresetDefinition` to a
    :class:`PresetGetResponse` suitable for the get endpoint response.

    Parameter ``value_type`` strings are resolved via :func:`resolve_value_type`
    (offloaded to a thread to avoid blocking the event loop on a cold start).
    """
    builder = convert_to_builder(preset_def)
    raw_parameters = preset_def.parameters
    resolved_value_types = await asyncio.to_thread(lambda: [resolve_value_type(p.value_type) for p in raw_parameters])
    return PresetGetResponse(
        preset_id=PresetId(preset_def.preset_id),
        version=1,
        name=preset_def.name,
        description=preset_def.description,
        long_description=preset_def.long_description,
        difficulty=cast(PresetDifficultyLiteral, preset_def.difficulty),
        tags=list(preset_def.tags),
        icon=preset_def.icon,
        source="plugin",
        plugin_id=plugin_id,
        builder_template=builder,
        parameters=[
            PresetParameterContract(
                glyph_key=p.glyph_key,
                label=p.label,
                description=p.description,
                value_type=resolved_vt,
                default_value=p.default_value,
            )
            for p, resolved_vt in zip(raw_parameters, resolved_value_types, strict=True)
        ],
        is_published=True,
        created_by=None,
        created_at=None,
        updated_at=None,
    )


def _matches_filters(
    item: PresetListItem,
    *,
    difficulty: PresetDifficultyLiteral | None,
    search: str | None,
) -> bool:
    """Return ``True`` when *item* passes the given list-endpoint filters.

    Mirrors the filtering logic applied by the DB query so that plugin presets
    and DB presets are filtered consistently before being merged.

    - ``difficulty``: exact match (case-sensitive, matching the DB behaviour).
    - ``search``: case-insensitive substring match across ``name``,
      ``description``, and each entry in ``tags``.
    """
    if difficulty is not None and item.difficulty != difficulty:
        return False
    if search is not None:
        needle = search.lower()
        haystack = " ".join([item.name, item.description] + item.tags).lower()
        if needle not in haystack:
            return False
    return True


# ---------------------------------------------------------------------------
# Read endpoints
# ---------------------------------------------------------------------------


@router.get("/list")
async def list_presets(
    pagination: Annotated[PaginationSpec, Depends()],
    auth_context: AuthContext = Depends(get_auth_context),
    difficulty: PresetDifficultyLiteral | None = None,
    search: str | None = None,
    published_only: bool = True,
) -> PresetListResponse:
    """Return a paginated, filterable list of preset summaries.

    Filters:
    - ``difficulty``: exact match on the difficulty field.
    - ``search``: case-insensitive substring match across name, description, and tags.
    - ``published_only``: when ``False``, admin callers may retrieve unpublished presets too.

    By default only published presets are returned.  ``builder_template`` and
    ``parameters`` are omitted; use ``/get`` to retrieve the full preset.

    Results are drawn from two sources and merged before pagination:
    - **Plugin presets**: in-memory, read-only presets provided by loaded plugins.
      They are always treated as published and appear first in the merged list.
    - **DB presets**: user-managed presets stored in the database.
    """
    # Non-admin callers may never bypass the published filter.
    if not published_only and not auth_context.has_admin():
        raise HTTPException(status_code=403, detail="Only admins may list unpublished presets.")

    # --- Plugin presets (always published; apply filters in-process) ----------
    # Collect plugin presets in a thread so the event loop is not blocked by
    # the plugin-manager lock acquisition.
    raw_plugin_presets = await asyncio.to_thread(get_all_plugin_presets)
    plugin_items: list[PresetListItem] = [
        item
        for plugin_id, preset_def in raw_plugin_presets
        if _matches_filters(
            item := _plugin_preset_to_list_item(preset_def, plugin_id=f"{plugin_id.store}/{plugin_id.local}"),
            difficulty=difficulty,
            search=search,
        )
    ]

    # --- DB presets -----------------------------------------------------------
    # TODO(perf): offset=0, limit=None fetches all matching DB rows into memory
    # so they can be merged with plugin presets before pagination. This won't
    # scale past ~1k presets. Fix: add a DB count query and compute the DB
    # offset/limit accounting for the number of plugin presets that precede
    # the requested page window.
    rows = await db.list_presets(
        difficulty=difficulty,
        search=search,
        offset=0,
        limit=None,  # fetch all matching rows; pagination applied after merge
        published_only=published_only,
    )
    db_items = [
        PresetListItem(
            preset_id=PresetId(cast(str, row.preset_id)),
            version=cast(int, row.version),
            name=cast(str, row.name),
            description=cast(str, row.description),
            difficulty=cast(PresetDifficultyLiteral, row.difficulty),
            tags=cast(list[str], row.tags) if row.tags is not None else [],
            icon=cast(str, row.icon),
            source="user",
            builder_template=BlueprintBuilder.model_validate(cast(dict, row.builder_template)),
            is_published=cast(bool, row.is_published),
            created_by=cast(str | None, row.created_by),
            created_at=str(row.created_at) if row.created_at is not None else None,
            updated_at=str(row.updated_at) if row.updated_at is not None else None,
        )
        for row in rows
    ]

    # --- Merge, count, and paginate ------------------------------------------
    # Plugin presets are listed first (they are the canonical, curated set),
    # followed by DB-backed user presets.
    all_items = plugin_items + db_items
    total = len(all_items)
    start = pagination.start()
    page_items = all_items[start : start + pagination.page_size]

    return PresetListResponse(
        presets=page_items,
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get("/get")
async def get_preset(
    spec: Annotated[PresetLookup, Depends()],
    auth_context: AuthContext = Depends(get_auth_context),
) -> PresetGetResponse:
    """Return the full detail of a preset, including ``builder_template`` and ``parameters``.

    Plugin presets are checked first; if no plugin preset matches the given ID
    the lookup falls back to the database.  Returns the latest non-deleted DB
    version when ``version`` is omitted.
    Returns 404 if the preset does not exist or has been soft-deleted.
    """
    # --- Plugin preset fast-path ---------------------------------------------
    # find_plugin_preset acquires the plugin-manager lock; offload to a thread.
    result = await asyncio.to_thread(find_plugin_preset, str(spec.preset_id))
    if result is not None:
        plugin_id, preset_def = result
        return await _plugin_preset_to_get_response(preset_def, plugin_id=f"{plugin_id.store}/{plugin_id.local}")

    # --- DB fallback ---------------------------------------------------------
    try:
        row = await db.get_preset(spec.preset_id, spec.version)
    except PresetNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    if row is None:
        raise HTTPException(status_code=404, detail=f"Preset {spec.preset_id!r} not found.")

    # ``resolve_value_type`` may block on the plugin updater thread for up to
    # _PLUGINS_READY_TIMEOUT_S seconds on a cold start; offload the per-parameter
    # resolution loop to a thread so the event loop is not blocked.
    raw_parameters = cast(list[dict], row.parameters) if row.parameters is not None else []
    resolved_value_types = await asyncio.to_thread(lambda: [resolve_value_type(p["value_type"]) for p in raw_parameters])
    return PresetGetResponse(
        preset_id=PresetId(cast(str, row.preset_id)),
        version=cast(int, row.version),
        name=cast(str, row.name),
        description=cast(str, row.description),
        long_description=cast(str | None, row.long_description),
        difficulty=cast(PresetDifficultyLiteral, row.difficulty),
        tags=cast(list[str], row.tags) if row.tags is not None else [],
        icon=cast(str, row.icon),
        source="user",
        builder_template=BlueprintBuilder.model_validate(row.builder_template),
        parameters=[
            PresetParameterContract(
                glyph_key=p["glyph_key"],
                label=p["label"],
                description=p["description"],
                value_type=resolved_vt,
                default_value=p["default_value"],
            )
            for p, resolved_vt in zip(raw_parameters, resolved_value_types, strict=True)
        ],
        is_published=cast(bool, row.is_published),
        created_by=cast(str | None, row.created_by),
        created_at=str(row.created_at) if row.created_at is not None else None,
        updated_at=str(row.updated_at) if row.updated_at is not None else None,
    )


# ---------------------------------------------------------------------------
# Write endpoints (admin-only)
# ---------------------------------------------------------------------------


@router.post("/create")
async def create_preset(
    body: PresetCreateRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> PresetCreateResponse:
    """Create a new preset.

    Admin-only.  Returns the new ``preset_id`` and ``version=1``.
    Returns 403 for non-admin callers.
    """
    if not auth_context.has_admin():
        raise HTTPException(status_code=403, detail="Only admins may create presets.")

    preset_id, version = await db.create_preset(
        auth_context=auth_context,
        name=body.name,
        description=body.description,
        long_description=body.long_description,
        difficulty=body.difficulty,
        tags=body.tags,
        icon=body.icon,
        builder_template=body.builder_template.model_dump(),
        parameters=[p.model_dump() for p in body.parameters],
        is_published=body.is_published,
        created_by=auth_context.user_id,
    )
    return PresetCreateResponse(preset_id=preset_id, version=version)


@router.post("/update")
async def update_preset(
    body: PresetUpdateRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> PresetUpdateResponse:
    """Update an existing preset by inserting a new version.

    Admin-only.  Uses optimistic locking: ``body.version`` must match the
    current latest version in the database.
    Returns 403 for non-admin callers or when the preset is plugin-provided,
    404 if the preset does not exist, and 409 on a version conflict.
    """
    if not auth_context.has_admin():
        raise HTTPException(status_code=403, detail="Only admins may update presets.")
    if await asyncio.to_thread(find_plugin_preset, str(body.preset_id)) is not None:
        raise HTTPException(status_code=403, detail="Cannot modify plugin-provided presets.")

    try:
        preset_id, version = await db.add_preset_version(
            preset_id=body.preset_id,
            auth_context=auth_context,
            expected_version=body.version,
            name=body.name,
            description=body.description,
            long_description=body.long_description,
            difficulty=body.difficulty,
            tags=body.tags,
            icon=body.icon,
            builder_template=body.builder_template.model_dump(),
            parameters=[p.model_dump() for p in body.parameters],
            is_published=body.is_published,
            created_by=auth_context.user_id,
        )
    except PresetNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PresetVersionConflict as e:
        raise HTTPException(status_code=409, detail=str(e))
    except PresetAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    return PresetUpdateResponse(preset_id=preset_id, version=version)


@router.post("/delete")
async def delete_preset(
    body: PresetDeleteRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> None:
    """Soft-delete all versions of a preset.

    Admin-only.  Uses optimistic locking: ``body.version`` must match the
    current latest version in the database.
    Returns 403 for non-admin callers or when the preset is plugin-provided,
    404 if the preset does not exist, and 409 on a version conflict.
    """
    if not auth_context.has_admin():
        raise HTTPException(status_code=403, detail="Only admins may delete presets.")
    if await asyncio.to_thread(find_plugin_preset, str(body.preset_id)) is not None:
        raise HTTPException(status_code=403, detail="Cannot modify plugin-provided presets.")

    try:
        await db.soft_delete_preset(
            body.preset_id,
            expected_version=body.version,
            auth_context=auth_context,
        )
    except PresetNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PresetVersionConflict as e:
        raise HTTPException(status_code=409, detail=str(e))
    except PresetAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))


# ---------------------------------------------------------------------------
# Publish / unpublish endpoint (admin-only, no version increment)
# ---------------------------------------------------------------------------


@router.post("/publish")
async def publish_preset(
    body: PresetPublishRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> None:
    """Toggle the ``is_published`` flag on a preset **without** creating a new version.

    Admin-only.  Publish-status is treated as metadata: toggling it does not
    constitute a content change and therefore must not increment the version
    counter.  Uses optimistic locking: ``body.version`` must match the current
    latest version in the database.

    Returns 403 for non-admin callers or when the preset is plugin-provided,
    404 if the preset does not exist, and 409 on a version conflict.
    """
    if not auth_context.has_admin():
        raise HTTPException(status_code=403, detail="Only admins may change preset publish status.")
    if await asyncio.to_thread(find_plugin_preset, str(body.preset_id)) is not None:
        raise HTTPException(status_code=403, detail="Cannot modify plugin-provided presets.")

    try:
        await db.patch_preset_publish_status(
            body.preset_id,
            is_published=body.is_published,
            expected_version=body.version,
            auth_context=auth_context,
        )
    except PresetNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PresetVersionConflict as e:
        raise HTTPException(status_code=409, detail=str(e))
    except PresetAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))


# ---------------------------------------------------------------------------
# Instantiate endpoint (any authenticated user)
# ---------------------------------------------------------------------------


@router.post("/instantiate")
async def instantiate_preset(
    body: PresetInstantiateRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> PresetInstantiateResponse:
    """Materialise a preset template with user-supplied parameter values and optionally submit a run.

    Any authenticated user may call this endpoint.

    When ``auto_run=True`` (the default) the response includes ``blueprint_id``,
    ``blueprint_version``, ``run_id``, and ``attempt_count`` (all non-null).
    When ``auto_run=False`` the materialised builder is returned without
    persistence — the caller is expected to open it in the editor and save
    explicitly — so all of ``blueprint_id``, ``blueprint_version``, ``run_id``,
    and ``attempt_count`` are ``None``.

    Returns 404 if the preset does not exist or has been soft-deleted.
    Returns 422 if the materialised builder fails blueprint validation, with a
    structured ``detail`` containing ``global_errors`` and ``block_errors``.
    """
    try:
        result = await service.instantiate_preset(
            preset_id=body.preset_id,
            parameter_values=body.parameter_values,
            auth_context=auth_context,
            auto_run=body.auto_run,
        )
    except PresetNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PresetInstantiationValidationError as e:
        raise HTTPException(
            status_code=422,
            detail={"global_errors": e.global_errors, "block_errors": e.block_errors},
        )
    return PresetInstantiateResponse(
        builder=result.builder,
        blueprint_id=result.blueprint_id,
        blueprint_version=result.blueprint_version,
        run_id=result.run_id,
        attempt_count=result.attempt_count,
    )

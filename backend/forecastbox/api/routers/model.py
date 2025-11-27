# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Models API Router."""

import asyncio
import logging
import os
import shutil
import tempfile
from collections import defaultdict
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from forecastbox.api.utils import get_model_path
from forecastbox.config import config
from forecastbox.db.model import delete_download, finish_edit, get_download, get_edit, start_download, start_editing, update_progress
from forecastbox.models.metadata import ControlMetadata, set_control_metadata
from forecastbox.models.model import ModelInfo, get_model, model_info
from forecastbox.rjsf import ExportedSchemas
from forecastbox.schemas.model import ModelDownload

from ..types import ModelName
from .admin import get_admin_user

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["model"],
    responses={404: {"description": "Not found"}},
)

Category = str

# section: RESPONSE MODELS


class DownloadResponse(BaseModel):
    """Response model for model download operations."""

    download_id: str | None
    message: str
    status: Literal["not_downloaded", "in_progress", "errored", "completed"]
    progress: float
    error: str | None = None


class ModelDetails(BaseModel):
    download: DownloadResponse
    editable: bool


# section: UTILITY FUNCTIONS


def model_downloaded(model_id: str) -> bool:
    """Check if a model is downloaded."""
    model_path = get_model_path(model_id.replace("_", "/"))
    return model_path.exists()


def download2response(model_download: ModelDownload | None) -> DownloadResponse:
    """Convert a ModelDownload object to a DownloadResponse."""
    if model_download:
        if model_download.error:
            return DownloadResponse(
                download_id=model_download.model_id,  # type: ignore[invalid-argument-type] # NOTE sqlalchemy quirk
                message="Download failed. To retry, call delete_model first",
                status="errored",
                progress=0.0,
                error=model_download.error,  # type: ignore[invalid-argument-type] # NOTE sqlalchemy quirk
            )
        if model_download.progress >= 100:
            return DownloadResponse(
                download_id=model_download.model_id,  # type: ignore[invalid-argument-type] # NOTE sqlalchemy quirk
                message="Download already completed.",
                status="completed",
                progress=100.0,
            )
        return DownloadResponse(
            download_id=model_download.model_id,  # type: ignore[invalid-argument-type] # NOTE sqlalchemy quirk
            message="Download in progress.",
            status="in_progress",
            progress=float(model_download.progress),
        )
    return DownloadResponse(
        download_id=None,
        message="Model not downloaded.",
        status="not_downloaded",
        progress=0.0,
    )


async def get_manifest() -> str:
    """Fetch the model manifest."""
    manifest_path = os.path.join(config.api.model_repository, "MANIFEST")
    async with httpx.AsyncClient() as client:
        response = await client.get(manifest_path)
        response.raise_for_status()
        return response.text


async def all_available_models() -> dict[Category, list[ModelName]]:
    """Get all models from the manifest, regardless of download status."""
    response = await get_manifest()
    models = defaultdict(list)
    for model in response.split("\n"):
        model = model.strip()
        if not model or model.startswith("#"):
            continue
        if "/" not in model:
            category, name = "", model
        else:
            category, name = model.split("/", 1)
        models[category].append(name)
    return models


async def get_downloaded_models() -> dict[Category, list[ModelName]]:
    """Get models that are already downloaded."""
    models = defaultdict(list)
    for model in Path(config.api.data_path).glob("**/*.ckpt"):
        model_path = model.relative_to(config.api.data_path)
        category, name = model_path.parts[:-1], model_path.name
        models["/".join(category)].append(name.replace(".ckpt", ""))
    return models


# section: MODEL DOWNLOAD


async def download_file(model_id: str, url: str, download_path: str) -> None:
    """Download a file from a given URL and save it to the specified path."""
    try:
        tempfile_path = tempfile.NamedTemporaryFile(prefix="model_", suffix=".ckpt", delete=False)
        async with httpx.AsyncClient(follow_redirects=True) as client_http:
            logger.debug(f"Starting download for {model_id=} from {url=} into {tempfile_path.name=}")
            async with client_http.stream("GET", url) as response:
                response.raise_for_status()
                total = int(response.headers.get("Content-Length", 0))
                downloaded = 0
                chunk_size = 1024 * 1024  # 1MB chunks
                with open(tempfile_path.name, "wb") as file:
                    async for chunk in response.aiter_bytes(chunk_size):
                        if chunk:
                            file.write(chunk)
                            downloaded += len(chunk)
                            progress = float(downloaded) / total * 100 if total else 0.0
                            await update_progress(model_id, int(progress), None)
                logger.debug(f"Download completed for {model_id=}, total bytes: {downloaded}")
                shutil.move(tempfile_path.name, download_path)
        await update_progress(model_id, 100, None)
    except Exception as e:
        await update_progress(model_id, -1, repr(e))


@router.post("/{model_id}/download")
async def download(model_id: str, background_tasks: BackgroundTasks, admin=Depends(get_admin_user)) -> DownloadResponse:
    """Download a model."""
    repo = config.api.model_repository.removesuffix("/")
    model_path = f"{repo}/{model_id.replace('_', '/')}.ckpt"

    existing_download = await get_download(model_id)
    if existing_download:
        return download2response(existing_download)

    model_download_path = Path(get_model_path(model_id.replace("_", "/")))
    model_download_path.parent.mkdir(parents=True, exist_ok=True)

    if model_download_path.exists():
        return DownloadResponse(
            download_id=None,
            message="Download already completed.",
            status="completed",
            progress=100.0,
        )

    await start_download(model_id)
    background_tasks.add_task(download_file, model_id, model_path, model_download_path)
    return DownloadResponse(
        download_id=model_id,
        message="Download started.",
        status="in_progress",
        progress=0.0,
    )


@router.delete("/{model_id}")
async def delete_model(model_id: str, admin=Depends(get_admin_user)) -> DownloadResponse:
    """Delete a model."""
    await delete_download(model_id)
    model_path = get_model_path(model_id.replace("_", "/"))
    if not model_path.exists():
        return DownloadResponse(
            download_id=None,
            message="Model not found.",
            status="not_downloaded",
            progress=0.0,
        )
    os.remove(model_path)
    return DownloadResponse(
        download_id=None,
        message="Model deleted.",
        status="not_downloaded",
        progress=0.0,
    )


@router.post("/flush")
async def flush_inprogress_downloads(admin=Depends(get_admin_user)) -> None:
    """Flush in-progress downloads."""
    await delete_download(None)


# section: MODEL AVAILABILITY


@router.get("/available")
async def get_available_models() -> dict[Category, list[ModelName]]:
    """Get a list of available models sorted into categories."""
    return await get_downloaded_models()


@router.get("")
async def get_models(admin=Depends(get_admin_user)) -> dict[str, ModelDetails]:
    """Fetch a dictionary of models with their details."""
    models = {}
    available_models = await all_available_models()

    for category, model_names in available_models.items():
        for model_name in model_names:
            model_id = f"{category}/{model_name}" if category else model_name
            not_in_edit = (await get_edit(model_id)) is None
            existing_download = await get_download(f"{category}_{model_name}" if category else model_name)
            download = download2response(existing_download)
            is_downloaded = model_downloaded(model_id)
            if is_downloaded:
                download.status = "completed"
            models[model_id] = ModelDetails(download=download, editable=not_in_edit and is_downloaded)

    return models


# section: MODEL METADATA


@router.get("/{model_id}/metadata")
async def get_model_metadata(model_id: str, admin=Depends(get_admin_user)) -> ControlMetadata:
    """Get metadata for a specific model."""
    model_path = get_model_path(model_id.replace("_", "/"))
    if not model_path.exists():
        raise HTTPException(status_code=404, detail="Model not found")
    return ControlMetadata.from_checkpoint(model_path)


@router.get("/{model_id}/metadata_form")
async def get_model_metadata_form(model_id: str, admin=Depends(get_admin_user)) -> ExportedSchemas:
    """Get metadata form for a specific model."""
    model_path = get_model_path(model_id.replace("_", "/"))
    if not model_path.exists():
        raise HTTPException(status_code=404, detail="Model not found")
    metadata = ControlMetadata.from_checkpoint(model_path)
    return metadata.form.export_all()


async def _update_model_metadata(model_id: str, metadata: ControlMetadata) -> ControlMetadata:
    """Update metadata for a specific model."""
    try:
        model_path = get_model_path(model_id.replace("_", "/"))
        if not model_path.exists():
            raise HTTPException(status_code=404, detail="Model not found")
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, set_control_metadata, model_path, metadata)
        return metadata
    finally:
        await finish_edit(model_id)


@router.patch("/{model_id}/metadata")
async def patch_model_metadata(
    model_id: str, data: ControlMetadata, background_tasks: BackgroundTasks, admin=Depends(get_admin_user)
) -> None:
    """Patch metadata for a specific model."""
    if not model_downloaded(model_id):
        raise HTTPException(status_code=404, detail="Model not found")
    if not await start_editing(model_id, str(data.model_dump())):
        raise HTTPException(status_code=409, detail="Concurrent model edit in progress")
    # background_tasks.add_task(_update_model_metadata, model_id, data)
    try:
        await _update_model_metadata(model_id, data)
    except Exception as e:
        msg = f"failed to edit model metadata due to {repr(e)}"
        logger.exception(msg)
        raise HTTPException(status_code=400, detail=msg)


# section: MODEL INFO


@router.get("/{model_id}/form")
async def get_model_form(model_id: str) -> ExportedSchemas:
    """Get the form schema for a specific model."""
    model = get_model(get_model_path(model_id))
    return model.form.export_all()


@lru_cache(maxsize=128)
@router.get("/{model_id}/info")
async def get_model_info(model_id: str, admin=Depends(get_admin_user)) -> ModelInfo:
    """Get basic information about the model."""
    return model_info(get_model_path(model_id))


@router.post("/{model_id}/spec")
async def get_model_spec(model_id: str, admin=Depends(get_admin_user)) -> dict[str, Any]:
    """Get Qubed Specification for a model."""
    try:
        return get_model(checkpoint=get_model_path(model_id)).qube().to_json()
    except FileNotFoundError:
        raise HTTPException(404, f"Cannot find {model_id}")

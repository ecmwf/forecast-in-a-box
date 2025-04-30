"""Models API Router."""

from collections import defaultdict
from uuid import uuid4
from fastapi import APIRouter, BackgroundTasks, HTTPException
import os

from functools import lru_cache

from typing import TYPE_CHECKING, Any, Literal
from pathlib import Path

import httpx
import requests
import tempfile
import shutil
from pydantic import BaseModel

from ..types import ModelSpecification, ModelName
from forecastbox.models import Model

from forecastbox.settings import API_SETTINGS
from forecastbox.models import Model
from forecastbox.api.database import db

router = APIRouter(
    tags=["model"],
    responses={404: {"description": "Not found"}},
)


def get_model_path(model: str) -> Path:
    """Get the path to a model."""
    return (Path(API_SETTINGS.data_path) / model).with_suffix(".ckpt").absolute()

Category = str

# Model Availability
@router.get("/available")
async def get_available_models() -> dict[Category, list[ModelName]]:
    """
    Get a list of available models sorted into categories.

    Returns
    -------
    dict[Category, list[ModelName]]
        Dictionary containing model categories and their models
    """

    manifest_path = os.path.join(API_SETTINGS.model_repository, "MANIFEST")

    response = requests.get(manifest_path)
    if response.status_code != 200:
        raise HTTPException(response.status_code, f"Failed to fetch manifest from {manifest_path}")

    models = defaultdict(list)

    for model in response.text.split("\n"):
        cat, name = model.split("/")
        models[cat].append(name)
    return models

class DownloadResponse(BaseModel):
    download_id: str | None
    message: str
    status: Literal['not_downloaded', 'in_progress', 'errored', 'completed']
    progress: float
    error: str | None = None


async def download_file(download_id: str, url: str, download_path: str) -> DownloadResponse:

    collection = db.get_collection("model-downloads")
    try:
        tempfile_path = tempfile.NamedTemporaryFile(prefix="model_", suffix=".ckpt", delete=False)

        async with httpx.AsyncClient() as client_http:
            async with client_http.stream("GET", url) as response:
                response.raise_for_status()
                total = int(response.headers.get("Content-Length", 0))
                downloaded = 0
                chunk_size = 1024
                file_path = tempfile_path.name
                with open(file_path, "wb") as file:
                    async for chunk in response.aiter_bytes(chunk_size):
                        file.write(chunk)
                        downloaded += len(chunk)
                        progress = int((downloaded / total) * 100) if total else 0
                        collection.update_one(
                            {"_id": download_id},
                            {"$set": {"progress": progress}},
                        )

                shutil.move(file_path, download_path)
        collection.update_one(
            {"_id": download_id},
            {"$set": {"status": "completed"}},
        )
    except Exception as e:
        collection.update_one(
            {"_id": download_id},
            {"$set": {"status": "errored", "error": str(e)}},
        )

@router.get("/{model_id}/downloaded")
async def check_if_downloaded(model_id: str) -> DownloadResponse:
    """Check if a model has been downloaded."""

    model_path = get_model_path(model_id.replace("_", "/"))
    if model_path.exists():
        return DownloadResponse(
            download_id=None,
            message="Download already completed.",
            status='completed',
            progress=100.00,
        )

    collection = db.get_collection("model-downloads")
    existing_download = collection.find_one({"model": model_id})
    if existing_download:
        return DownloadResponse(
            download_id=existing_download["_id"],
            message="Download in progress.",
            status=existing_download["status"],
            progress=existing_download["progress"],
            error=existing_download.get('error', None)
        )
        
    return DownloadResponse(
        download_id=None,
        message="Model not downloaded.",
        status='not_downloaded',
        progress=0.00,
    )

@router.post("/{model_id}/download")
def download(model_id: str, background_tasks: BackgroundTasks) -> DownloadResponse:
    """Download a model."""

    repo = API_SETTINGS.model_repository

    repo = repo.removesuffix('/')
    
    model_path = f"{repo}/{model_id.replace('_', '/')}.ckpt"

    collection = db.get_collection("model-downloads")
    
    existing_download = collection.find_one({"model": model_id})
    if existing_download:
        return DownloadResponse(
            download_id=existing_download["_id"],
            message="Download already in progress.",
            status=existing_download["status"],
            progress=existing_download["progress"]
        )

    model_download_path = Path(get_model_path(model_id.replace("_", "/")))
    model_download_path.parent.mkdir(parents=True, exist_ok=True)

    if model_download_path.exists():
        return DownloadResponse(
            download_id=None,
            message="Download already completed.",
            status='completed',
            progress=100.00,
        )

    download_id = str(uuid4())
    
    collection.insert_one({
        "_id": download_id,
        "model": model_id,
        "status": "in_progress",
        "progress": 0
    })
    background_tasks.add_task(download_file, download_id, model_path, model_download_path)
    return DownloadResponse(
        download_id=download_id,
        message="Download started.",
        status='in_progress',
        progress=0.00,
    )

@router.delete("/{model_id}")
def delete_model(model_id: str) -> DownloadResponse:
    """Delete a model."""

    model_path = get_model_path(model_id.replace("_", "/"))
    if not model_path.exists():
        return DownloadResponse(
            download_id=None,
            message="Model not found.",
            status='not_downloaded',
            progress=0.00,
        )

    collection = db.get_collection("model-downloads")
    try:
        os.remove(model_path)
        if collection.find_one({"model": model_id}):
            collection.delete_one({"model": model_id})
    except Exception as e:
        raise e
    
    return DownloadResponse(
        download_id=None,
        message="Model deleted.",
        status='not_downloaded',
        progress=0.00,
    )

class InstallResponse(BaseModel):
    installed: bool
    error: str | None = None

@router.post("/{model_id}/install")
def install(model_id: str) -> InstallResponse:

    anemoi_versions = Model.versions(str(get_model_path(model_id.replace("_", "/"))))
    import subprocess

    BLACKLISTED_INSTALLS = ['anemoi', 'anemoi-training', 'anemoi-inference', 'anemoi-utils']
    
    try:
        packages = [f"{key}=={val}" for key, val in anemoi_versions.items() if key not in BLACKLISTED_INSTALLS]
        if packages:
            subprocess.run(["uv", "pip", "install", *packages, '--no-cache'], check=True)
    except Exception as e:
        return InstallResponse(
            installed=False,
            error=str(e)
        )
    
    return InstallResponse(
        installed=True,
        error=None
    )


# Model Info
@lru_cache(maxsize=128)
@router.get("/{model_id}/info")
async def get_model_info(model_id: str) -> dict[str, Any]:
    """
    Get basic information about a model.

    Parameters
    ----------
    model_id : str
            Model to load, directory separated by underscores

    Returns
    -------
    dict[str, Any]
            Dictionary containing model information
    """
    return Model.info(get_model_path(model_id.replace("_", "/")))


@router.post("/{model_id}/spec")
async def get_model_spec(model_id: str, modelspec: ModelSpecification) -> dict[str, Any]:
    """
    Get the Qubed model spec as a json.

    Parameters
    ----------
    modelspec : ModelSpecification
            Model Specification

    Returns
    -------
    dict[str, Any]
            Json Dump of the Qubed model spec
    """

    model_dict = dict(lead_time=modelspec.lead_time, date=modelspec.date, ensemble_members=modelspec.ensemble_members)

    return Model(get_model_path(modelspec.model), **model_dict).qube().to_json()

"""Models API Router."""

from collections import defaultdict
from uuid import uuid4
from fastapi import APIRouter, BackgroundTasks
import os

from functools import lru_cache

from typing import TYPE_CHECKING, Any, Literal
from pathlib import Path

import httpx
import requests
import tempfile
import shutil
from pydantic import BaseModel

from ..types import ModelSpecification
from forecastbox.models import Model

from forecastbox.settings import APISettings
from forecastbox.models import Model
from forecastbox.api.database import db

SETTINGS = APISettings()

router = APIRouter(
    tags=["models"],
    responses={404: {"description": "Not found"}},
)


def get_model_path(model: str) -> Path:
    """Get the path to a model."""
    return (Path(SETTINGS.data_path) / model).with_suffix(".ckpt").absolute()


# Model Availability
@router.get("/available")
async def get_available_models() -> dict[str, list[str]]:
    """
    Get a list of available models sorted into categories.

    Returns
    -------
    dict[str, list[str]]
            Dictionary containing model categories and their models
    """

    manifest_path = os.path.join(SETTINGS.model_repository, "MANIFEST")

    response = requests.get(manifest_path)
    if response.status_code != 200:
        raise Exception(f"Failed to fetch manifest from {manifest_path}")

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
                        db.update_one('model-downloads',
                            {"_id": download_id},
                            {"$set": {"progress": progress}},
                        )

                shutil.move(file_path, download_path)
        db.update_one('model-downloads',
            {"_id": download_id},
            {"$set": {"status": "completed"}},
        )
    except Exception as e:
        db.update_one('model-downloads',
            {"_id": download_id},
            {"$set": {"status": "errored", "error": str(e)}},
        )

@router.get("/download/{model}")
async def check_if_downloaded(model: str) -> DownloadResponse:
    """Check if a model has been downloaded."""

    model_path = get_model_path(model.replace("_", "/"))
    if model_path.exists():
        return DownloadResponse(
            download_id=None,
            message="Download already completed.",
            status='completed',
            progress=100.00,
        )

    existing_download = db.find_one('model-downloads', {"model": model})
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

@router.post("/download/{model}")
def download(model: str, background_tasks: BackgroundTasks) -> DownloadResponse:
    """Download a model."""

    repo = SETTINGS.model_repository

    repo = repo.removesuffix('/')
    
    model_path = f"{repo}/{model.replace('_', '/')}.ckpt"

    existing_download = db.find_one('model-downloads', {"model": model})
    if existing_download:
        return DownloadResponse(
            download_id=existing_download["_id"],
            message="Download already in progress.",
            status=existing_download["status"],
            progress=existing_download["progress"]
        )

    model_download_path = Path(get_model_path(model.replace("_", "/")))
    model_download_path.parent.mkdir(parents=True, exist_ok=True)

    if model_download_path.exists():
        return DownloadResponse(
            download_id=None,
            message="Download already completed.",
            status='completed',
            progress=100.00,
        )

    download_id = str(uuid4())
    
    db.insert_one('model-downloads', {
        "_id": download_id,
        "model": model,
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

@router.delete("/{model}")
def delete_model(model: str) -> DownloadResponse:
    """Delete a model."""

    model_path = get_model_path(model.replace("_", "/"))
    if not model_path.exists():
        return DownloadResponse(
            download_id=None,
            message="Model not found.",
            status='not_downloaded',
            progress=0.00,
        )

    try:
        os.remove(model_path)
        if db.find_one('model-downloads', {"model": model}):
            db.delete_one('model-downloads', {"model": model})
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

@router.post("/install/{model}")
def install(model: str) -> InstallResponse:
    from anemoi.inference.checkpoint import Checkpoint

    ckpt = Checkpoint(str(get_model_path(model.replace("_", "/"))))

    anemoi_versions = {key.replace('.','-'): val for key, val in ckpt.provenance_training()["module_versions"].items() if key.startswith("anemoi")}
    import subprocess

    BLACKLISTED_INSTALLS = ['anemoi', 'anemoi-training', 'anemoi-inference', 'anemoi-utils']
    
    try:
        packages = [f"{key}=={'.'.join(val.split('.')[:3])}" for key, val in anemoi_versions.items() if key not in BLACKLISTED_INSTALLS]
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
@router.get("/info/{model}")
async def get_model_info(model: str) -> dict[str, Any]:
    """
    Get basic information about a model.

    Parameters
    ----------
    model : str
            Model to load, directory separated by underscores

    Returns
    -------
    dict[str, Any]
            Dictionary containing model information
    """

    from anemoi.inference.checkpoint import Checkpoint

    ckpt = Checkpoint(str(get_model_path(model.replace("_", "/"))))

    anemoi_versions = {key: val for key, val in ckpt.provenance_training()["module_versions"].items() if key.startswith("anemoi")}

    return {
        "timestep": ckpt.timestep,
        "diagnostics": ckpt.diagnostic_variables,
        "prognostics": ckpt.prognostic_variables,
        "area": ckpt.area,
        "local_area": True,
        "grid": ckpt.grid,
        "versions": anemoi_versions,
    }


@router.post("/spec")
async def get_model_spec(modelspec: ModelSpecification) -> dict[str, Any]:
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

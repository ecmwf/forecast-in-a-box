"""Models API Router."""

from collections import defaultdict
from fastapi import APIRouter
import os

from functools import lru_cache

from typing import TYPE_CHECKING, Any
from pathlib import Path

from ..types import ModelSpecification
from forecastbox.models import Model

from forecastbox.settings import get_settings
from forecastbox.models import Model

import httpx
import requests
import tempfile
import shutil

SETTINGS = get_settings()

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


@router.get("/downloaded/{model}")
async def check_if_downloaded(model: str) -> bool:
    """Check if a model has been downloaded."""

    model_path = get_model_path(model.replace("_", "/"))

    return model_path.exists()


@router.get("/download/{model}")
async def download(model: str) -> str:
    """Download a model."""
    repo = SETTINGS.model_repository

    model = model.replace("_", "/")
    model_path = f"{repo}/{model}.ckpt"

    model_download_path = Path(get_model_path(model.replace("_", "/")))
    model_download_path.parent.mkdir(parents=True, exist_ok=True)

    if model_download_path.exists():
        return str(model_download_path)

    temp_download_path = tempfile.NamedTemporaryFile(suffix=".ckpt.tmp")

    async with httpx.AsyncClient() as client:
        async with client.stream("GET", model_path) as response:
            response.raise_for_status()
            with open(temp_download_path.name, "wb") as f:
                async for chunk in response.aiter_bytes(chunk_size=8192):
                    f.write(chunk)

    shutil.move(temp_download_path.name, model_download_path)
    return str(model_download_path)

@router.get("/install/{model}")
async def install(model: str) -> bool:
    from anemoi.inference.checkpoint import Checkpoint

    ckpt = Checkpoint(str(get_model_path(model.replace("_", "/"))))

    anemoi_versions = {key: val for key, val in ckpt.provenance_training()["module_versions"].items() if key.startswith("anemoi")}

    for key, val in anemoi_versions.items():
        if key == "anemoi":
            continue
        
        import subprocess
        import sys
        try:
            subprocess.run([sys.executable, "-m", "pip", "install", f"{key}=={val}"], check=True)
        except Exception as e:
            raise e
        
    return True


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


@router.post("/spec/{model}")
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

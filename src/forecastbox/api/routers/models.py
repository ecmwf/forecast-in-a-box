"""Models API Router."""

from collections import defaultdict
from fastapi import APIRouter
import os

from functools import lru_cache

from typing import TYPE_CHECKING, Any

from ..models import open_checkpoint, convert_to_model_spec, MODEL_CHECKPOINT_PATH, TESTING_LOOKUP

if TYPE_CHECKING:
    from qubed import Qube


router = APIRouter(
    tags=["models"],
    responses={404: {"description": "Not found"}},
)

# Model Availability
@router.get("/available")
async def get_available_models() -> dict[str, list[str]]:
    models = defaultdict(list)
    if not os.path.exists(MODEL_CHECKPOINT_PATH):
        return {'testing': list(TESTING_LOOKUP.keys())}
    

    for subdir in os.listdir(MODEL_CHECKPOINT_PATH):
        subdir_path = os.path.join(MODEL_CHECKPOINT_PATH, subdir)
        if os.path.isdir(subdir_path):
            for model in os.listdir(subdir_path):
                if model.endswith(".ckpt"):
                    models[subdir].append(model)
    return models

@router.get("/registry")
async def registry():
    """Check registry."""
    raise NotImplementedError("Checking model registry is not yet implemented")

# Model Downloading
@router.get("/downloaded/{model_name}")
async def check_if_downloaded(model_name):
    return {"downloaded": os.path.exists(os.path.join(MODEL_CHECKPOINT_PATH, model_name))}
    
@router.get("/download/{model_name}")
async def download(model_name):
    """Download a model."""
    raise NotImplementedError("Downloading models is not yet implemented")
    
# Model Info
@lru_cache
@router.get("/info/{model_name}")
async def get_model_info(model_name: str) -> dict[str, Any]:
    ckpt = open_checkpoint(model_name)

    variables = [
        *ckpt.diagnostic_variables,
        *ckpt.prognostic_variables,
    ]
    return {"timestep": ckpt.timestep, "params": variables, "local_area": True}


@lru_cache
@router.get("/spec/{model_name}")
async def get_model_spec(model_name: str) -> dict[str, Any]:
    """Get Qubed model Spec"""
    ckpt = open_checkpoint(model_name)
    return convert_to_model_spec(ckpt).to_json()


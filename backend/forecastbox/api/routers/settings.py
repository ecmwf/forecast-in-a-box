"""Settings API Router."""

from fastapi import APIRouter, Response
from fastapi.responses import HTMLResponse

from pydantic import BaseModel

from ..database import db

from forecastbox.settings import CascadeSettings, APISettings, CASCADE_SETTINGS, API_SETTINGS

router = APIRouter(
    tags=["settings"],
    responses={404: {"description": "Not found"}},
)

class ExposedSettings(BaseModel):
    """Exposed settings for modification"""
    api: APISettings = API_SETTINGS
    cascade: CascadeSettings = CASCADE_SETTINGS

@router.get('')
async def get_settings() -> ExposedSettings:
    """Get current settings"""
    settings = ExposedSettings()
    del settings.api.api_url
    return settings

@router.post('')
async def post_settings(settings: ExposedSettings) -> HTMLResponse:
    """Update settings"""
    def update(old: BaseModel, new: BaseModel):
        for key, val in new.model_dump().items():
            setattr(old, key, val)
    
    try:
        update(API_SETTINGS, settings.api)
        update(CASCADE_SETTINGS, settings.cascade)
    except Exception as e:
        return HTMLResponse(content=str(e), status_code=500)

    return HTMLResponse(content="Settings updated successfully", status_code=200)
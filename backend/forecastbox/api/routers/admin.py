# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Settings API Router."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse

from pydantic import BaseModel
from forecastbox.settings import CascadeSettings, APISettings, CASCADE_SETTINGS, API_SETTINGS

from forecastbox.auth.users import current_active_user
from forecastbox.schemas.user import User


def get_admin_user(user: User = Depends(current_active_user)):
    """Dependency to get the current active user."""
    if not user.is_superuser:
        raise HTTPException(status_code=403, detail="Not an admin user")
    return user


router = APIRouter(
    tags=["admin"],
    responses={404: {"description": "Not found"}},
)


class ExposedSettings(BaseModel):
    """Exposed settings for modification"""

    api: APISettings = API_SETTINGS
    cascade: CascadeSettings = CASCADE_SETTINGS


@router.get("/settings", response_model=ExposedSettings)
async def get_settings(admin=Depends(get_admin_user)) -> ExposedSettings:
    """Get current settings"""
    settings = ExposedSettings()
    del settings.api.api_url
    return settings


@router.post("/settings", response_class=HTMLResponse)
async def post_settings(settings: ExposedSettings, admin=Depends(get_admin_user)) -> HTMLResponse:
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

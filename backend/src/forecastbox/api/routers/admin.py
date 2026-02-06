# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Admin API Router."""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import UUID4, BaseModel
from sqlalchemy import delete, select, update

from forecastbox.api.updates import Release, get_local_release, get_most_recent_release, get_pylock, mark_release, save_pylock
from forecastbox.auth.users import current_active_user
from forecastbox.config import BackendAPISettings, CascadeSettings, ProductSettings, config
from forecastbox.db.user import async_session_maker
from forecastbox.rjsf import ExportedSchemas, FormDefinition, from_pydantic
from forecastbox.schemas.user import UserRead, UserTable, UserUpdate

logger = logging.getLogger(__name__)


def get_admin_user(user: UserRead | None = Depends(current_active_user)) -> UserRead | None:
    """Dependency to get the current active user."""
    if config.auth.passthrough:
        return user
    if user is None or not user.is_superuser:
        raise HTTPException(status_code=403, detail="Not an admin user")
    return user


router = APIRouter(
    tags=["admin"],
    responses={404: {"description": "Not found"}},
)


class ExposedSettings(BaseModel):
    """Exposed settings for modification"""

    product: ProductSettings = config.product

    api: BackendAPISettings = config.api
    cascade: CascadeSettings = config.cascade

    def to_rjsf(self) -> FormDefinition:
        """Convert settings to RJSF form definition"""
        fields, required = from_pydantic(self)
        return FormDefinition(
            title="Settings",
            fields=fields,
            required=required,
            formData=self.model_dump(),
        )


class GetReleaseStatusResponse(BaseModel):
    local_release: Release
    local_release_age_days: int
    newest_available_release: Release


class UpdateReleaseResponse(BaseModel):
    release: Release


@router.get("/release", response_model=GetReleaseStatusResponse)
async def get_release_status(admin=Depends(get_admin_user)) -> GetReleaseStatusResponse:
    """Get release status"""
    local_dt, local_release = get_local_release()
    newest_available_release = await get_most_recent_release()

    local_release_age_days = (datetime.now(timezone.utc) - local_dt.astimezone(timezone.utc)).days

    return GetReleaseStatusResponse(
        local_release=local_release,
        local_release_age_days=local_release_age_days,
        newest_available_release=newest_available_release,
    )


@router.post("/release", response_model=UpdateReleaseResponse)
async def update_release(tag: str | None = None, admin=Depends(get_admin_user)) -> UpdateReleaseResponse:
    """Update release"""
    if tag:
        release = Release.from_string(tag)
    else:
        release = await get_most_recent_release()

    pylock_content = await get_pylock(release)
    mark_release(release)
    save_pylock(pylock_content, release)

    # NOTE it would be tempting to just re-launch the entrypoint. But alas we need to re-launch whole fiab.sh

    return UpdateReleaseResponse(release=release)


@router.get("/settings", response_model=ExportedSchemas)
async def get_settings(admin=Depends(get_admin_user)) -> ExportedSchemas:
    """Get current settings"""
    settings = ExposedSettings()
    return settings.to_rjsf().export_all()


@router.patch("/settings", response_class=HTMLResponse)
async def update_settings(settings: ExposedSettings, admin=Depends(get_admin_user)) -> HTMLResponse:
    """Update settings"""

    def update(old: BaseModel, new: BaseModel):
        for key, val in new.model_dump().items():
            setattr(old, key, val)

    try:
        update(config.api, settings.api)
        update(config.product, settings.product)
        update(config.cascade, settings.cascade)
    except Exception as e:
        return HTMLResponse(content=str(e), status_code=500)

    config.save_to_file()

    return HTMLResponse(content="Settings updated successfully", status_code=200)


@router.get("/users", response_model=list[UserRead])
async def get_users(admin=Depends(get_admin_user)) -> list[UserRead]:
    """Get all users"""
    async with async_session_maker() as session:
        query = select(UserTable)
        return (await session.execute(query)).unique().scalars().all()  # type: ignore[invalid-return-type] # NOTE db


@router.get("/users/{user_id}", response_model=UserRead)
async def get_user(user_id: UUID4, admin=Depends(get_admin_user)) -> UserRead:
    """Get a specific user by ID"""
    async with async_session_maker() as session:
        query = select(UserTable).where(UserTable.id == user_id)  # type: ignore[invalid-argument-type] # NOTE db
        user = (await session.execute(query)).unique().scalars().all()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return user[0]


@router.delete("/users/{user_id}", response_class=HTMLResponse)
async def delete_user(user_id: UUID4, admin=Depends(get_admin_user)) -> HTMLResponse:
    """Delete a user by ID"""
    async with async_session_maker() as session:
        query = delete(UserTable).where(UserTable.id == user_id)  # type: ignore[invalid-argument-type] # NOTE db
        _ = await session.execute(query)
        await session.commit()
        # NOTE is there a way to get number of affected rows from the result? Except for running two selects...
        # if not user:
        #    raise HTTPException(status_code=404, detail="User not found")
        return HTMLResponse(content="User deleted successfully", status_code=200)


@router.put("/users/{user_id}", response_model=UserRead)
async def update_user(user_id: UUID4, user_data: UserUpdate, admin=Depends(get_admin_user)) -> UserRead:
    """Update a user by ID"""
    async with async_session_maker() as session:
        update_dict = {k: v for k, v in user_data.model_dump().items() if v is not None}
        # TODO the password is actually stored as 'hash_password' -- invoke some of the auth meths here
        if "password" in update_dict:
            raise HTTPException(status_code=404, detail="Password update not supported")
        query = update(UserTable).where(UserTable.id == user_id).values(**update_dict)  # type: ignore[invalid-argument-type] # NOTE db
        _ = await session.execute(query)
        await session.commit()
        query = select(UserTable).where(UserTable.id == user_id)  # type: ignore[invalid-argument-type] # NOTE db
        user = (await session.execute(query)).scalars().all()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return user[0]


@router.patch("/users/{user_id}", response_class=HTMLResponse)
async def patch_user(user_id: UUID4, update_dict: dict, admin: UserRead = Depends(get_admin_user)) -> HTMLResponse:
    """Patch a user by ID"""
    async with async_session_maker() as session:
        query = update(UserTable).where(UserTable.id == user_id).values(**update_dict)  # type: ignore[invalid-argument-type] # NOTE db
        _ = await session.execute(query)
        await session.commit()
        return HTMLResponse(content="User updated successfully", status_code=200)


@dataclass
class ConfigResponse:
    language_iso639_1: str
    authType: Literal["anonymous", "authenticated"]
    loginEndpoint: str | None  # is None <=> authType is anonymous


config_response = ConfigResponse(
    language_iso639_1="en",
    authType="anonymous" if config.auth.passthrough else "authenticated",
    loginEndpoint="/v1/auth/oidc/authorize" if not config.auth.passthrough else None,
)


@router.get("/uiConfig")
async def get_ui_config() -> ConfigResponse:
    """Config for the frontend to properly configure itself. Contains no internal or sensitive data"""
    return config_response

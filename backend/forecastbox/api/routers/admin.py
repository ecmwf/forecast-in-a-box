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
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse

from pydantic import BaseModel, UUID4
from forecastbox.config import config, BackendAPISettings, CascadeSettings

from forecastbox.auth.users import current_active_user
from forecastbox.schemas.user import UserRead, UserTable, UserUpdate
from forecastbox.db.user import async_session_maker
from sqlalchemy import select, delete, update

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

    api: BackendAPISettings = config.api
    cascade: CascadeSettings = config.cascade


@router.get("/settings", response_model=ExposedSettings)
async def get_settings(admin=Depends(get_admin_user)) -> ExposedSettings:
    """Get current settings"""
    settings = ExposedSettings()
    return settings


@router.post("/settings", response_class=HTMLResponse)
async def post_settings(settings: ExposedSettings, admin=Depends(get_admin_user)) -> HTMLResponse:
    """Update settings"""

    def update(old: BaseModel, new: BaseModel):
        for key, val in new.model_dump().items():
            setattr(old, key, val)

    try:
        update(config.api, settings.api)
        update(config.cascade, settings.cascade)
    except Exception as e:
        return HTMLResponse(content=str(e), status_code=500)

    return HTMLResponse(content="Settings updated successfully", status_code=200)


@router.get("/users", response_model=list[UserRead])
async def get_users(admin=Depends(get_admin_user)) -> list[UserRead]:
    """Get all users"""
    async with async_session_maker() as session:
        query = select(UserTable)
        return (await session.execute(query)).unique().scalars().all()


@router.get("/users/{user_id}", response_model=UserRead)
async def get_user(user_id: UUID4, admin=Depends(get_admin_user)) -> UserRead:
    """Get a specific user by ID"""
    async with async_session_maker() as session:
        query = select(UserTable).where(UserTable.id == user_id)
        user = (await session.execute(query)).unique().scalars().all()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return user[0]


@router.delete("/users/{user_id}", response_class=HTMLResponse)
async def delete_user(user_id: UUID4, admin=Depends(get_admin_user)) -> HTMLResponse:
    """Delete a user by ID"""
    async with async_session_maker() as session:
        query = delete(UserTable).where(UserTable.id == user_id)
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
        update_dict = {k: v for k, v in user_data.dict().items() if v is not None}
        # TODO the password is actually stored as 'hash_password' -- invoke some of the auth meths here
        if "password" in update_dict:
            raise HTTPException(status_code=404, detail="Password update not supported")
        query = update(UserTable).where(UserTable.id == user_id).values(**update_dict)
        _ = await session.execute(query)
        await session.commit()
        query = select(UserTable).where(UserTable.id == user_id)
        user = (await session.execute(query)).scalars().all()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return user[0]


@router.patch("/users/{user_id}", response_class=HTMLResponse)
async def patch_user(user_id: UUID4, update_dict: dict, admin: UserRead = Depends(get_admin_user)) -> HTMLResponse:
    """Patch a user by ID"""
    async with async_session_maker() as session:
        query = update(UserTable).where(UserTable.id == user_id).values(**update_dict)
        _ = await session.execute(query)
        await session.commit()
        return HTMLResponse(content="User updated successfully", status_code=200)

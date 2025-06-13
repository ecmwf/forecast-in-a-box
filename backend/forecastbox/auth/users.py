# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from typing import Optional

from fastapi import Depends, Request
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin
from fastapi_users.authentication import (
    AuthenticationBackend,
    BearerTransport,
    JWTStrategy,
)
from fastapi_users.db import SQLAlchemyUserDatabase

from forecastbox.schemas.user import UserTable
from forecastbox.db.user import get_user_db
from forecastbox.config import config
import pydantic
import logging
from sqlalchemy import func, select, update
from forecastbox.db.user import async_session_maker

SECRET = config.auth.jwt_secret.get_secret_value()

logger = logging.getLogger(__name__)


class UserManager(UUIDIDMixin, BaseUserManager[UserTable, pydantic.UUID4]):
    reset_password_token_secret = SECRET
    verification_token_secret = SECRET

    async def on_after_register(self, user: UserTable, request: Optional[Request] = None):
        async with async_session_maker() as session:
            query = select(func.count("*")).select_from(UserTable)
            user_count = (await session.execute(query)).scalar()
            if user_count == 1:
                query = update(UserTable).where(UserTable.id == user.id).values(is_superuser=True)
                _ = await session.execute(query)
                await session.commit()

    async def on_after_forgot_password(self, user: UserTable, token: str, request: Optional[Request] = None):
        logger.error(f"User {user.id} has forgot their password. Reset token: {token}")

    async def on_after_request_verify(self, user: UserTable, token: str, request: Optional[Request] = None):
        logger.error(f"Verification requested for user {user.id}. Verification token: {token}")


async def get_user_manager(user_db: SQLAlchemyUserDatabase = Depends(get_user_db)):
    yield UserManager(user_db)


bearer_transport = BearerTransport(tokenUrl="/api/v1/auth/jwt/login")


def get_jwt_strategy() -> JWTStrategy:
    return JWTStrategy(secret=SECRET, lifetime_seconds=24 * 60 * 60)


auth_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)

fastapi_users = FastAPIUsers[UserTable, pydantic.UUID4](get_user_manager, [auth_backend])

current_active_user = fastapi_users.current_user(active=True)

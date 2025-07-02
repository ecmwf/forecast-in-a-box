# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from typing import Optional

from fastapi import Depends, HTTPException, Request, responses
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin
from fastapi_users.authentication import (
    AuthenticationBackend,
    CookieTransport,
    JWTStrategy,
)
from fastapi_users.db import SQLAlchemyUserDatabase

import pydantic
import logging
from sqlalchemy import func, select, update
import jwt

from forecastbox.schemas.user import UserTable
from forecastbox.db.user import get_user_db
from forecastbox.config import config
from forecastbox.db.user import async_session_maker


SECRET = config.auth.jwt_secret.get_secret_value()
COOKIE_NAME = "forecastbox_auth"

logger = logging.getLogger(__name__)


def verify_entitlements(user: UserTable) -> bool:
    if config.auth.oidc is None or config.auth.oidc.required_roles is None:
        logger.warning("Entitlements are not configured, skipping verification.")
        return True

    if not hasattr(user, "oauth_accounts") or not user.oauth_accounts:
        return False

    for account in user.oauth_accounts:
        if account.access_token is None:
            continue
        try:
            # Decode the JWT without verifying the signature to check the scope
            entitlements = jwt.decode(account.access_token, options={"verify_signature": False})
            for entitlement in config.auth.oidc.required_roles:
                if entitlement in entitlements.get("entitlements"):
                    return True
        except jwt.PyJWTError as e:
            logger.error(f"Failed to decode JWT for user {user.id}: {e}")

    return False


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

    async def on_after_login(self, user: UserTable, request: Optional[Request] = None, response: Optional[responses.Response] = None):
        if not verify_entitlements(user):
            logger.error(f"User {user.id} does not have the required entitlements.")
            raise HTTPException(status_code=403, detail="You do not have the required entitlements to access this resource.")

        response.status_code = 302
        response.headers["location"] = "/"

    async def on_after_forgot_password(self, user: UserTable, token: str, request: Optional[Request] = None):
        logger.error(f"User {user.id} has forgot their password. Reset token: {token}")

    async def on_after_request_verify(self, user: UserTable, token: str, request: Optional[Request] = None):
        logger.error(f"Verification requested for user {user.id}. Verification token: {token}")


async def get_user_manager(user_db: SQLAlchemyUserDatabase = Depends(get_user_db)):
    yield UserManager(user_db)


# bearer_transport = BearerTransport(tokenUrl="/api/v1/auth/jwt/login")
cookie_transport = CookieTransport(cookie_max_age=3600, cookie_name=COOKIE_NAME)


def get_jwt_strategy() -> JWTStrategy:
    return JWTStrategy(secret=SECRET, lifetime_seconds=24 * 60 * 60)


auth_backend = AuthenticationBackend(
    name="jwt",
    transport=cookie_transport,
    get_strategy=get_jwt_strategy,
)

fastapi_users = FastAPIUsers[UserTable, pydantic.UUID4](get_user_manager, [auth_backend])

current_active_user = fastapi_users.current_user(active=True)

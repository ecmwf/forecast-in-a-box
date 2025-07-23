# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from fastapi import APIRouter

from forecastbox.auth.users import fastapi_users
from forecastbox.auth.users import auth_backend
from forecastbox.auth.oidc import oauth_client


from forecastbox.schemas.user import UserRead, UserCreate, UserUpdate

from forecastbox.config import config

router = APIRouter()
SECRET = config.auth.jwt_secret.get_secret_value()

# OAuth routes

if oauth_client is not None:
    oauth_router = fastapi_users.get_oauth_router(
        oauth_client,
        auth_backend,
        SECRET,
        redirect_url=config.auth.public_url + "/api/v1/auth/oidc/callback",
        is_verified_by_default=True,
        associate_by_email=True,
    )

    router.include_router(
        oauth_router,
        prefix="/auth/oidc",
        tags=["auth"],
    )


# JWT login routes
router.include_router(fastapi_users.get_auth_router(auth_backend), prefix="/auth/jwt", tags=["auth"])

# Registration routes
router.include_router(fastapi_users.get_register_router(UserRead, UserCreate), prefix="/auth", tags=["auth"])
router.include_router(
    fastapi_users.get_reset_password_router(),
    prefix="/auth",
    tags=["auth"],
)
router.include_router(
    fastapi_users.get_verify_router(UserRead),
    prefix="/auth",
    tags=["auth"],
)
# Password reset/verify/email optional
# TODO we would like to somehow connect this with config.auth.passthrough, instead of hotfixing via middleware in entrypoint.py
router.include_router(fastapi_users.get_users_router(UserRead, UserUpdate), prefix="/users", tags=["users"])

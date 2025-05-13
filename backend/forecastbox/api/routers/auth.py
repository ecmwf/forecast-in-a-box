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


from forecastbox.schemas.user import UserRead, UserCreate, UserUpdate

router = APIRouter()

# # OAuth routes
# router.include_router(
#     fastapi_users.get_oauth_router(auth_provider),
#     prefix="/auth/ecmwf",
#     tags=["auth"]
# )

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
router.include_router(fastapi_users.get_users_router(UserRead, UserUpdate), prefix="/users", tags=["users"])

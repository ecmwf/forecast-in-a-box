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

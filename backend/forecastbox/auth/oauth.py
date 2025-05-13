# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from fastapi_users.authentication.strategy.db import DatabaseStrategy
from fastapi_users.authentication import AuthenticationBackend


from fastapi_users.oauth.client import OAuthClient
from fastapi_users.oauth.provider import OAuthProvider
from fastapi_users.oauth.transport import OAuth2AuthorizeCallbackTransport

from app.auth.users import get_user_db
from app.config import settings

oauth_transport = OAuth2AuthorizeCallbackTransport(callback_url=settings.google_callback_url)

google_client = OAuthClient(
    client_id=settings.google_client_id,
    client_secret=settings.google_client_secret,
    authorize_endpoint="https://accounts.google.com/o/oauth2/v2/auth",
    access_token_endpoint="https://oauth2.googleapis.com/token",
    scope=["email", "profile"],
)


async def get_user_info(token: str):
    import httpx

    async with httpx.AsyncClient() as client:
        r = await client.get("https://www.googleapis.com/oauth2/v2/userinfo", headers={"Authorization": f"Bearer {token}"})
        return r.json()


ecmwf_oauth_provider = OAuthProvider(
    name="ecmwf",
    client=google_client,
    transport=oauth_transport,
    get_user_info=get_user_info,
)

# Setup backend and attach to users
auth_backend = AuthenticationBackend(
    name="ecmwf",
    transport=oauth_transport,
    get_strategy=lambda: DatabaseStrategy(get_user_db, lifetime_seconds=3600),
)

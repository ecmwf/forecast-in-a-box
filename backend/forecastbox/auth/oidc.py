# (C) Copyright 2025- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from httpx_oauth.clients.openid import OpenID

from forecastbox.config import config


if config.auth.oidc is not None:
    oauth_client = OpenID(
        client_id=config.auth.oidc.client_id,
        client_secret=config.auth.oidc.client_secret.get_secret_value(),
        openid_configuration_endpoint=config.auth.oidc.openid_configuration_endpoint,
        name=config.auth.oidc.name,
        base_scopes=config.auth.oidc.scopes,
    )
else:
    oauth_client = None
    # If OIDC is not configured, we do not create the client and no routes will be made.

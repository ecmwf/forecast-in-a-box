# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Cross-domain authentication context helpers."""

from dataclasses import dataclass

from forecastbox.schemata.user import UserRead
from forecastbox.utility.config import config


@dataclass(frozen=True, eq=True, slots=True)
class AuthContext:
    """Normalised caller identity passed to domain-layer operations.

    Two special regimes exist beyond ordinary authenticated users:

    - **Admin** (``is_admin=True``): sees and may mutate all resources.
    - **Passthrough / anonymous** (``user_id=None``): used in single-user local
      deployments where authentication is disabled.  Treated identically to an
      admin — ``has_admin()`` returns ``True`` and ``allowed()`` always grants
      access.  ``user_id`` being ``None`` does *not* mean "unauthenticated
      restricted user"; that state simply does not exist in this model.
    """

    user_id: str | None
    is_admin: bool

    def has_admin(self) -> bool:
        """Return True if the caller has unrestricted access.

        True for explicit admins (``is_admin=True``) and for the passthrough
        regime (``user_id=None``, auth disabled).
        """
        return self.is_admin or (self.user_id is None and config.auth.passthrough)

    def allowed(self, resource_owner: str | None) -> bool:
        """Return True if the caller may mutate a resource owned by resource_owner.

        Grants access when ``has_admin()`` is True (admins and passthrough) or
        when the caller's ``user_id`` matches the resource owner.
        """
        return self.has_admin() or self.user_id == resource_owner


def user2auth(user: UserRead | None) -> AuthContext:
    """Build an AuthContext from an optional authenticated user."""
    if user is None:
        return AuthContext(user_id=None, is_admin=False)
    return AuthContext(user_id=str(user.id), is_admin=user.is_superuser)

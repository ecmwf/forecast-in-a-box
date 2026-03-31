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

from forecastbox.schemas.user import UserRead


@dataclass(frozen=True, eq=True, slots=True)
class AuthContext:
    """Normalised caller identity passed to domain-layer operations."""

    user_id: str | None
    is_admin: bool

    def has_admin(self) -> bool:
        """Return True if the caller has admin privileges or is unauthenticated (anonymous regime)."""
        return self.is_admin or self.user_id is None

    def allowed(self, resource_owner: str | None) -> bool:
        """Return True if the caller may access or mutate a resource owned by resource_owner.

        Grants access to admins and to callers whose user_id matches the owner.
        """
        return self.is_admin or self.user_id == resource_owner


def user2auth(user: UserRead | None) -> AuthContext:
    """Build an AuthContext from an optional authenticated user."""
    if user is None:
        return AuthContext(user_id=None, is_admin=False)
    return AuthContext(user_id=str(user.id), is_admin=user.is_superuser)

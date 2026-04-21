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

PASSTHROUGH_USER_ID = "user"
"""Sentinel user-id stored in all resources created under passthrough (auth-disabled) mode."""


@dataclass(frozen=True, eq=True, slots=True)
class AuthContext:
    """Normalised caller identity passed to domain-layer operations.

    Two special regimes exist beyond ordinary authenticated users:

    - **Admin** (``is_admin=True``): sees and may mutate all resources.
    - **Passthrough**: used in single-user local deployments where
      authentication is disabled.  Created with ``is_admin=True`` and
      ``user_id=PASSTHROUGH_USER_ID`` so that ``created_by`` columns are
      always non-null and admin access is granted.
    """

    user_id: str
    is_admin: bool

    def has_admin(self) -> bool:
        """Return True if the caller has unrestricted access (``is_admin=True``)."""
        return self.is_admin

    def allowed(self, resource_owner: str) -> bool:
        """Return True if the caller may mutate a resource owned by resource_owner.

        Grants access when ``has_admin()`` is True (admins and passthrough) or
        when the caller's ``user_id`` matches the resource owner.
        """
        return self.has_admin() or self.user_id == resource_owner

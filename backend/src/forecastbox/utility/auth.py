# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Cross-domain authentication context helpers."""

from dataclasses import dataclass, field

PASSTHROUGH_USER_ID = "user"
"""Sentinel user-id stored in all resources created under passthrough (auth-disabled) mode."""


@dataclass(frozen=True, eq=True, slots=True)
class AuthContext:
    """Normalised caller identity passed to domain-layer operations.

    Two special regimes exist beyond ordinary authenticated users:

    - **Admin** (``is_admin=True``): sees and may mutate all resources.
    - **Passthrough** (``is_passthrough=True``): used in single-user local
      deployments where authentication is disabled.  Treated identically to an
      admin — ``has_admin()`` returns ``True`` and ``allowed()`` always grants
      access.  In this regime ``user_id`` is set to ``PASSTHROUGH_USER_ID``
      ("anonymous") rather than ``None`` so that ``created_by`` columns are
      always non-null.
    """

    user_id: str
    is_admin: bool
    is_passthrough: bool = field(default=False)

    def has_admin(self) -> bool:
        """Return True if the caller has unrestricted access.

        True for explicit admins (``is_admin=True``) and for the passthrough
        regime (``is_passthrough=True``, auth disabled).
        """
        return self.is_admin or self.is_passthrough

    def allowed(self, resource_owner: str) -> bool:
        """Return True if the caller may mutate a resource owned by resource_owner.

        Grants access when ``has_admin()`` is True (admins and passthrough) or
        when the caller's ``user_id`` matches the resource owner.
        """
        return self.has_admin() or self.user_id == resource_owner

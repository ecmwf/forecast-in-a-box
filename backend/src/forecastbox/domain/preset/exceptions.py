# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Domain exceptions for the preset layer.

Raised by domain.preset.db and domain.preset.service; translated to
HTTP responses at the router boundary.
"""


class PresetNotFound(Exception):
    """Raised when a requested Preset does not exist (or has been soft-deleted)."""


class PresetAccessDenied(Exception):
    """Raised when the actor lacks permission to mutate a Preset."""


class PresetVersionConflict(Exception):
    """Raised when the provided version does not match the current version in the database."""


class PresetInstantiationValidationError(Exception):
    """Raised when a preset's materialized builder fails blueprint validation.

    Carries the structured validation errors so callers can surface them to the
    user without re-running validation.
    """

    def __init__(self, global_errors: list[str], block_errors: dict) -> None:
        self.global_errors = global_errors
        self.block_errors = block_errors
        super().__init__(f"Preset instantiation failed validation: global_errors={global_errors!r}, block_errors={block_errors!r}")

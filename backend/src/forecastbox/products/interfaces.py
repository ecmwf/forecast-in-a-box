# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


import enum


class Interfaces(enum.StrEnum):
    """Enumeration of available interfaces for products."""

    STANDARD = "standard"
    DETAILED = "detailed"
    INTERACTIVE = "interactive"
    ALL = "all"

    @classmethod
    def get_all_interfaces(cls) -> list[str]:
        """Return a list of all available interfaces."""
        return [interface.value for interface in cls]

    @classmethod
    def is_valid_interface(cls, interface: str) -> bool:
        """Check if the provided interface is valid."""
        return interface in cls.get_all_interfaces()

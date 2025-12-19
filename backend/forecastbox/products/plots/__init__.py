# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


from forecastbox.products.interfaces import Interfaces
from forecastbox.products.registry import CategoryRegistry

plot_product_registry = CategoryRegistry(
    "Plots",
    interface=[Interfaces.STANDARD, Interfaces.DETAILED],
    description="Display products as plots",
    title="Plots",
)

from . import (
    maps,  # noqa: F401, E402
    meteogram,  # noqa: F401, E402
    vertical_profile,  # noqa: F401, E402
)

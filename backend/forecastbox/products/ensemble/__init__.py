# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from forecastbox.products.registry import CategoryRegistry
from ..interfaces import Interfaces

ensemble_registry = CategoryRegistry(
    "ensemble", interface=Interfaces.DETAILED, description="Capture the distribution of the ensemble", title="Ensemble"
)

from .base import BaseEnsembleProduct  # noqa: F401, E402
from . import threshold, quantiles, ens_stats  # noqa: F401, E402

__all__ = [
    "ensemble_registry",
]

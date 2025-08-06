# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import itertools
from typing import Any

from earthkit.workflows import fluent
from forecastbox.products.ensemble.base import BasePProcEnsembleProduct
from forecastbox.products.product import GenericTemporalProduct

from . import ensemble_registry


class BaseEnsembleStats(BasePProcEnsembleProduct, GenericTemporalProduct):
    _type: str | None = None

    allow_multiple_levels = True
    allow_multiple_params = True
    allow_multiple_steps = True

    @property
    def qube(self):
        return self.make_generic_qube()

    def get_sources(self, product_spec, model, source: fluent.Action) -> dict[str, fluent.Action]:
        params = product_spec["param"]
        step = product_spec["step"]
        return {"forecast": self.select_on_specification({"param": params, "step": step}, source)}

    def mars_request(self, product_spec: dict[str, Any]):
        """Mars request for ensemble stats."""
        params = product_spec["param"]
        steps = product_spec["step"]
        levtype = product_spec.get("levtype", None)

        requests = []

        for para, st in itertools.product(params, steps):
            request: dict[str, Any] = {
                "type": self._type,
            }
            from anemoi.utils.grib import shortname_to_paramid

            param_id = shortname_to_paramid(para)

            request.update(
                {
                    "levtype": levtype,
                    "param": param_id,
                    "step": st,
                }
            )
            requests.append(request)
        return requests


@ensemble_registry("Ensemble Mean")
class ENSMS(BaseEnsembleStats):
    _type = "em"


@ensemble_registry("Ensemble Standard Deviation")
class ENSSTD(BaseEnsembleStats):
    _type = "es"

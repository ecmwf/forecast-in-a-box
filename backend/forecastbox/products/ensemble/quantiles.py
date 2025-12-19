# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from pathlib import Path
from typing import Any

import yaml
from earthkit.workflows import fluent
from qubed import Qube

from forecastbox.products.ensemble.base import BasePProcEnsembleProduct
from forecastbox.rjsf import StringSchema

from ..generic import generic_registry
from ..product import USER_DEFINED, GenericTemporalProduct
from . import ensemble_registry


class BaseQuantiles(BasePProcEnsembleProduct, GenericTemporalProduct):
    """Base Quantiles Product"""

    @property
    def formfields(self):
        formfields = super().formfields.copy()
        formfields.update(
            quantile=self._make_field(
                multiple=True,
                schema=StringSchema,
                title="Quantiles",
                description="Computed Quantile",
            ),
        )
        return formfields

    @property
    def model_assumptions(self):
        return {"quantile": "*"}

    def get_sources(self, product_spec, model, source: fluent.Action) -> dict[str, fluent.Action]:
        params = product_spec["param"]
        step = product_spec["step"]
        return {"forecast": self.select_on_specification({"param": params, "step": step}, source)}

    def mars_request(self, product_spec: dict[str, Any]):
        """Mars request for quantile."""
        quantile = product_spec["quantile"]
        params = product_spec["param"]
        step = product_spec["step"]
        levtype = product_spec.get("levtype", None)

        requests = []

        for para in params:
            for st in step:
                request: dict[str, Any] = {
                    "type": "pb",
                }
                from anemoi.utils.grib import shortname_to_paramid

                param_id = shortname_to_paramid(para)

                request.update(
                    {
                        "levtype": levtype,
                        "param": param_id,
                        "step": st,
                        "quantile": list(map(str, quantile)),
                    }
                )
                requests.append(request)
        return requests


@ensemble_registry("Quantiles")
class DefinedQuantiles(BaseQuantiles):
    @property
    def qube(self):
        defined = yaml.safe_load(open(Path(__file__).parent / "definitions/quantiles.yaml"))

        q = Qube.empty()
        for d in defined:
            q = q | Qube.from_datacube({"frequency": "*", **d})
        return q.compress()


@generic_registry("Quantiles")
class GenericQuantiles(BaseQuantiles):
    example = {
        "quantile": "99.0, 99.5",
    }

    @property
    def qube(self):
        return self.make_generic_qube(quantile=USER_DEFINED)

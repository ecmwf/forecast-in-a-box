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
from forecastbox.products.ensemble.base import BaseEnsembleProduct
from forecastbox.products.ensemble.base import BasePProcEnsembleProduct
from qubed import Qube

from ..export import export_fieldlist_as
from ..generic import generic_registry
from ..product import USER_DEFINED
from ..product import GenericParamProduct
from ..rjsf import FieldWithUI
from ..rjsf import StringSchema
from . import ensemble_registry


class BaseThresholdProbability(BaseEnsembleProduct):
    """Base Threshold Probability Product"""

    @property
    def formfields(self):
        formfields = super().formfields.copy()
        formfields.update(
            step=FieldWithUI(jsonschema=StringSchema(title="Step", description="Forecast step, e.g. 0-24, 0-168")),
            threshold=FieldWithUI(
                jsonschema=StringSchema(title="Threshold", description="Threshold value to apply, e.g. 0, 5, 10, etc.")
            ),
            operator=FieldWithUI(
                jsonschema=StringSchema(
                    title="Operator",
                    description="Operator to apply to the threshold, e.g. '>', '<', '==', etc.",
                    enum=["<", "<=", "==", ">=", ">"],
                )
            ),
        )
        return formfields

    @property
    def model_assumptions(self):
        return {"threshold": "*", "operator": "*", "step": "*"}


@generic_registry("Threshold Probability")
class GenericThresholdProbability(BaseThresholdProbability, GenericParamProduct):

    @property
    def qube(self):
        return self.make_generic_qube(threshold=USER_DEFINED, operator=USER_DEFINED, step=USER_DEFINED)

    def execute(self, product_spec, model, source):
        from earthkit.workflows import backends
        from earthkit.workflows import fluent
        from earthkit.workflows.plugins.anemoi.types import ENSEMBLE_DIMENSION_NAME

        source = source.sel(param=product_spec["param"])
        if "levlist" in product_spec:
            source = source.sel(levlist=product_spec["levlist"])

        payload = fluent.Payload(
            backends.threshold,
            (
                fluent.Node.input_name(0),
                product_spec["operator"],
                float(product_spec["threshold"]),
            ),
        )

        return (
            source.map(payload)
            .multiply(100)
            .mean(ENSEMBLE_DIMENSION_NAME)
            .map(export_fieldlist_as(format="grib"))
            .map(self.named_payload("Threshold Probability"))
        )


@ensemble_registry("Threshold Probability")
class DefinedThresholdProbability(BaseThresholdProbability, BasePProcEnsembleProduct):
    @property
    def defined(self) -> list[dict[str, Any]]:
        return yaml.safe_load(open(Path(__file__).parent / "definitions/threshold_probability.yaml"))

    @property
    def thresholds(self):
        defined = self.defined
        for defi in defined:
            defi["threshold"] = list((x[0] for x in defi["threshold"]))
        return defined

    def get_out_paramid(self, levtype, param, levlist, threshold, operator) -> int | None:
        defined = self.defined
        for defi in defined:
            if all(
                [
                    defi["levtype"] == levtype,
                    defi["param"] == param,
                    (defi["levlist"] == levlist) if levlist and levtype == "pl" else True,
                    defi["operator"] == operator,
                ]
            ):
                for thres in defi["threshold"]:
                    if thres[0] == threshold:
                        return thres[1]
        return None

    @property
    def qube(self):
        q = Qube.empty()
        for d in self.thresholds:
            q = q | Qube.from_datacube({"frequency": "*", **d, "step": USER_DEFINED})
        return q.compress()

    def get_sources(self, product_spec, model, source: fluent.Action) -> dict[str, fluent.Action]:
        params = product_spec["param"]
        step = product_spec["step"]
        if isinstance(step, str) and "-" in step:
            step = [int(x) for x in step.split("-")]
        return {"forecast": self.select_on_specification({"param": params, "step": step}, source)}

    def mars_request(self, product_spec: dict[str, Any]):
        """Mars request for threshold."""
        threshold = product_spec["threshold"]
        operator = product_spec["operator"]
        param = product_spec["param"]
        step = product_spec["step"]
        levtype = product_spec.get("levtype", None)

        paramid = self.get_out_paramid(levtype, param, product_spec.get("levlist", None), threshold, operator)
        if paramid is None:
            raise KeyError(
                f"Could not identify output paramid for {param!r} with threshold {threshold!r} and operator {operator!r}."
            )

        request = {
            "type": "ep",
            "levtype": levtype,
            "param": paramid,
            "step": step,
        }
        return request

from pathlib import Path
from typing import Any

import yaml

from qubed import Qube
from earthkit.workflows import fluent

from . import ensemble_registry
from ..product import GenericParamProduct, USER_DEFINED
from ..generic import generic_registry

from forecastbox.products.definitions import DESCRIPTIONS, LABELS
from forecastbox.products.ensemble.base import BasePProcEnsembleProduct, BaseEnsembleProduct


class BaseThresholdProbability(BaseEnsembleProduct):
    """Base Threshold Probability Product"""

    description = {
        **DESCRIPTIONS,
        "threshold": "Threshold",
    }
    label = {
        **LABELS,
        "threshold": "Threshold",
        "operator": "Operator",
    }

    @property
    def model_assumptions(self):
        return {"threshold": "*", "operator": "*", "step": "*"}


@generic_registry("Threshold Probability")
class GenericThresholdProbability(BaseThresholdProbability, GenericParamProduct):
    example = {
        "threshold": "10",
    }
    multiselect = {
        "param": True,
    }

    @property
    def qube(self):
        return self.make_generic_qube(threshold=USER_DEFINED, operator=USER_DEFINED, step=USER_DEFINED)

    def to_graph(self, product_spec, model, source):
        from earthkit.workflows.plugins.anemoi.fluent import ENSEMBLE_DIMENSION_NAME
        from earthkit.workflows import backends, fluent

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

        return source.map(payload).multiply(100).mean(ENSEMBLE_DIMENSION_NAME)


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
            raise KeyError(f"Could not identify output paramid for {param!r} with threshold {threshold!r} and operator {operator!r}.")

        request = {
            "type": "ep",
            "levtype": levtype,
            "param": paramid,
            "step": step,
        }
        return request

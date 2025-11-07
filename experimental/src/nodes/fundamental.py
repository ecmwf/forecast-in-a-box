


from ..abstract import Transform, ValidIfPrior, DefinedUserConfig, UIConfigSchema, EKW_TYPE, FLOW

from pydantic import BaseModel, Field, create_model
from qubed import Qube


KNOWN_DIMENSION_TYPES: dict[str, type] = {
    "time": str,
    "latitude": float,
    "longitude": float,
    "level": float,
    "ensemble": int,
    "param": str,
}

def config_from_prior(prior: EKW_TYPE) -> type[BaseModel]:
    entries = {
        str(dim): (list[KNOWN_DIMENSION_TYPES.get(str(dim), str)], Field(...))
        for dim in prior.nodes.dims if not str(dim).startswith("__")
    }
    return create_model('Configuration', __base__=BaseModel, **{k: v for k, v in entries.items()}) # type: ignore

def qube_from_prior(prior: EKW_TYPE) -> Qube:
    entries = {
        dim: prior.nodes[dim]
        for dim in prior.nodes.dims if not str(dim).startswith("__")
    }
    return Qube.from_datacube(**entries)  # type: ignore


class Select(ValidIfPrior, Transform):
    def configuration(self, prior: EKW_TYPE, flow: FLOW, config: DefinedUserConfig) -> UIConfigSchema:
        """Create a configuration schema for this source node."""
        _ = flow, config

        return UIConfigSchema(
            config_from_prior(prior),
            qube=qube_from_prior(prior)
        )
    
    def realise(self, prior: EKW_TYPE, config: DefinedUserConfig) -> EKW_TYPE:
        if prior is None:
            raise ValueError("Prior EKW is None, cannot perform selection.")
        return prior.sel(**config)
        

class Concatenate(ValidIfPrior, Transform):
    def configuration(self, prior: EKW_TYPE, flow: FLOW, config: DefinedUserConfig) -> UIConfigSchema:
        """Create a configuration schema for this source node."""
        _ = prior, flow, config

        class Configuration(BaseModel):
            dim: str = Field(..., description="The dimension to concatenate along")

        return UIConfigSchema(
            Configuration,
            qube=Qube.from_datacube(dict(dim=list(map(str, prior.nodes.dims))))
        )
    
    def realise(self, prior: EKW_TYPE, config: DefinedUserConfig) -> EKW_TYPE:
        if prior is None:
            raise ValueError("Prior EKW is None, cannot perform concatenation.")
        return prior.concatenate(dim=config['dim'])


from typing import TYPE_CHECKING
from ..abstract import Source, Transform, AbstractNode

from ..protocol import EKW_TYPE, FLOW, UIConfigSchema, DefinedUserConfig

from qubed import Qube
from pydantic import BaseModel, Field, create_model
from datetime import datetime

if TYPE_CHECKING:
    from anemoi.inference.metadata import Metadata

class BaseAnemoi(AbstractNode):
    def _get_checkpoint(self, model: str) -> str:
        return model

    def metadata(self, model: str) -> "Metadata":
        from anemoi.inference.checkpoint import Checkpoint
        return Checkpoint(self._get_checkpoint(model))._metadata

class AnemoiSource(BaseAnemoi, Source):

    def configuration(self, prior: None, flow: FLOW, config: DefinedUserConfig) -> UIConfigSchema:
        """Create a configuration schema for this source node."""
        _ = prior, flow

        model = config.get("model")
        if model is None:
            raise ValueError("Model must be specified in the configuration")
        metadata = self.metadata(model)

        class Configuration(BaseModel):
            date: datetime
            lead_time: int = Field(multiple_of=metadata.timestep.total_seconds() // 3600)
            ensemble_members: int | None = Field(None)

        return UIConfigSchema(
            Configuration,
            qube=None
        )

    def is_valid(self, prior: None, flow: FLOW) -> bool:
        """Check if this source node is valid."""
        _ = prior, flow
        return True

    def realise(self, prior: None, config: DefinedUserConfig) -> EKW_TYPE:
        """Realise this source node into an EKW based on the user-defined configuration."""
        _ = prior
        from earthkit.workflows.plugins.anemoi.fluent import from_input
        return from_input(**config)


class AnemoiTransform(BaseAnemoi, Transform):

    def configuration(self, prior: EKW_TYPE, flow: FLOW, config: DefinedUserConfig) -> UIConfigSchema:
        """Create a configuration schema for this source node."""
        _ = prior, flow

        model = config.get("model")
        if model is None:
            raise ValueError("Model must be specified in the configuration")
        metadata = self.metadata(model)
        
        class BaseConfiguration(BaseModel):
            lead_time: int = Field(multiple_of=metadata.timestep.total_seconds() // 3600)

        entries = {}

        from earthkit.workflows.plugins.anemoi.types import ENSEMBLE_DIMENSION_NAME
        
        if ENSEMBLE_DIMENSION_NAME not in prior.nodes.dims:
            entries['ensemble_members'] = (int | None, Field(None, description="Number of ensemble members to create"))

        return UIConfigSchema(
            create_model('Configuration', __base__=BaseConfiguration, **{k: v for k, v in entries.items()}),
            qube=None
        )

    def is_valid(self, prior: EKW_TYPE, flow: FLOW) -> bool:
        """Check if this source node is valid."""
        _ = prior, flow
        return True

    def realise(self, prior: EKW_TYPE, config: DefinedUserConfig) -> EKW_TYPE:
        """Realise this source node into an EKW based on the user-defined configuration."""
        from earthkit.workflows.plugins.anemoi.fluent import from_initial_conditions
        return from_initial_conditions(**config, initial_conditions=prior)

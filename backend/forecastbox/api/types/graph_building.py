# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from typing import Literal
from forecastbox.api.types.base import FIABBaseModel as BaseModel


class ActionConfigurationOption(BaseModel):
    title: str
    """Brief string to display in the ActionFactory detail"""
    description: str
    """Extended description, possibly with example values and their effect"""
    value_type: str
    """Will be used when deserializing the actual value"""
    # TODO do we want Literal instead of str for values? Do we prefer nesting or flattening for complex config?


ActionKind = Literal["source", "transform", "product", "sink"]


class ActionFactory(BaseModel):
    """When building a graph, user selects from an avaliable catalog of ActionFactories which
    have description of what they do and specification of configuration options they offer"""

    kind: ActionKind
    """Which role in a job does this action plays"""
    title: str
    """How to display in the catalog listing / partial graph"""
    description: str
    """Extended detail for the user"""
    configuration_options: dict[str, ActionConfigurationOption]
    """A key-value of config-option-key, config-option"""
    inputs: list[str]
    """A list of input names, such as 'initial conditions' or 'forecast', for the purpose of description/configuration"""


ActionFactoryId = str
ActionInstanceId = str


class ActionFactoryCatalog(BaseModel):
    factories: dict[ActionFactoryId, ActionFactory]


class ActionInstance(BaseModel):
    """As produced by ActionFactory *by the client* -- basically the configuration/inputs values"""

    action_factory_id: ActionFactoryId
    configuration_values: dict[str, str]
    """Keys come frome factory's `configuration_options`, values are serialized actual configuration values"""
    input_ids: dict[str, ActionInstanceId]
    """Keys come from factory's `inputs`, values are other actions in the (partial) graph"""


class GraphBuilder(BaseModel):
    actions: dict[ActionInstanceId, ActionInstance]


class GraphValidationExpansion(BaseModel):
    """When user submits invalid GraphBuilder, backend returns a structured validation result and completion options"""

    global_errors: list[str]
    action_errors: dict[ActionInstanceId, list[str]]
    possible_sources: list[ActionFactoryId]
    possible_expansions: dict[ActionInstanceId, list[ActionFactoryId]]

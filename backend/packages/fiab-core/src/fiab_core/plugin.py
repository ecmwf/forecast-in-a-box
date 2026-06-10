# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Types pertaining to declaring FIAB Plugins, in particular their Fable-based interface.
"""

from dataclasses import dataclass
from typing import Callable, NamedTuple

from cascade.low.func import Either
from earthkit.workflows.fluent import Action

from fiab_core.fable import (
    ActionLookup,
    BlockExpansion,
    BlockFactoryCatalogue,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    ConfigurationOptionRestriction,
)

Error = str


class BlockValidation(NamedTuple):
    result: Either[BlockInstanceOutput, Error]  # type:ignore[invalid-argument] # semigroup
    restrictions: ConfigurationOptionRestriction = {}

    def get_or_raise(self) -> BlockInstanceOutput:
        return self.result.get_or_raise()

    @property
    def t(self) -> BlockInstanceOutput | None:
        return self.result.t

    @property
    def e(self) -> Error | None:
        return self.result.e


Validator = Callable[[BlockInstance, dict[str, BlockInstanceOutput]], BlockValidation]
"""Given a block instance and its inputs, return either error or output and configuration restrictions"""

Expander = Callable[[BlockInstanceOutput], list[BlockExpansion]]
"""Given a block instance output, provide which block factories can expand it"""

Compiler = Callable[
    [ActionLookup, BlockInstanceId, BlockInstance], Either[Action, Error]  # type:ignore[invalid-argument] # semigroup
]
"""Given a cascade builder, represented as lookup of fluent actions, and a block instance corresponding to this plugin's Factory, either return the fluent action resulting from this block or an error"""


@dataclass(frozen=True, eq=True, slots=True)
class Plugin:
    """Base plugin with a block catalogue and default validate/expand/compile behavior.

    Override the methods in subclasses when a plugin needs custom logic that does not
    map 1:1 to the BlockFactory implementations.
    """

    catalogue: BlockFactoryCatalogue
    validator: Validator
    expander: Expander
    compiler: Compiler

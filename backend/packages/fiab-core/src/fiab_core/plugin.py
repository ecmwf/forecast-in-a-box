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

from dataclasses import dataclass, field, replace
from typing import Callable, Self

from cascade.low.func import Either
from earthkit.workflows.fluent import Action

from fiab_core.fable import (
    ActionLookup,
    BlockExpansion,
    BlockFactoryCatalogue,
    BlockInstance,
    BlockInstanceOutput,
    ConfigurationOptionRestriction,
)

Error = str


@dataclass(frozen=True, eq=True, slots=True)
class BlockValidationError:
    reason: str
    is_hard: bool

    def __add__(self, other: Self) -> Self:
        if not isinstance(other, BlockValidationError):
            raise TypeError(other.__class__.__name__)
        return replace(
            self,
            reason=self.reason + other.reason,
            is_hard=self.is_hard or other.is_hard,
        )


@dataclass(frozen=True, eq=True, slots=True)
class BlockValidation:
    result: Either[BlockInstanceOutput, BlockValidationError]
    restrictions: ConfigurationOptionRestriction = field(default_factory=dict)


Validator = Callable[[BlockInstance, dict[str, BlockInstanceOutput]], BlockValidation]
"""Given a block instance and its inputs, return either error or output and configuration restrictions"""

Expander = Callable[[BlockInstanceOutput], list[BlockExpansion]]
"""Given a block instance output (including from other plugin), provide which block factories from this plugin can expand it"""

Compiler = Callable[[ActionLookup, BlockInstance], Either[Action, Error]]  # type:ignore[invalid-argument] # semigroup
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

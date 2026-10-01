# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Parsers and utility methods for the types from definition.py

The grammar itself is declared in ``fable_types.lark`` (shipped with the package), and the
parse tree is converted either into FableType instances via FableTypeTransformer, or into a
plain json-like AST via AstDumpTransformer. The latter is a language-agnostic representation
used by the conformance suite in ``tests/conformance``.
"""

from importlib.resources import files
from typing import Any

import lark

from fiab_core.types.definitions import (
    ArtifactType,
    BoundingBoxWSENType,
    ClosedEnumType,
    DatetimeType,
    DateType,
    FableType,
    FloatType,
    GeoDomainSingleType,
    GeoDomainType,
    IntType,
    ListType,
    NoneType,
    OpenEnumType,
    ParameterType,
    StringType,
    TimeDeltaType,
    UnionType,
)
from fiab_core.types.exceptions import NotFableType
from fiab_core.types.traits import DivisibleBy, FableTrait, NonNegative, Positive

GRAMMAR = files("fiab_core.types").joinpath("fable_types.lark").read_text(encoding="utf-8")
"""The lark grammar of Fable type expressions, read from the package resources."""

_PARSER = lark.Lark(GRAMMAR, parser="lalr", lexer="contextual", start=["start", "single_trait"])

AstNode = dict[str, Any]
"""A json-like node of the AST produced by AstDumpTransformer."""


def _enum_item_value(token: lark.Token) -> str:
    """Raw value of an enum item token, with surrounding quotes (if any) removed."""
    if token.type in ("SQ_ITEM", "DQ_ITEM"):
        return token.value[1:-1]
    return token.value


class FableTypeTransformer(lark.Transformer[lark.Token, FableType]):
    """Converts a parse tree of the Fable type grammar into a FableType instance."""

    def start(self, children: list[FableType]) -> FableType:
        return children[0]

    def fable_type(self, children: list[Any]) -> FableType:
        parsed: FableType = children[0]
        if len(children) > 1:
            parsed.traits = children[1]
        return parsed

    def string_type(self, _: list[Any]) -> FableType:
        return StringType()

    def int_type(self, _: list[Any]) -> FableType:
        return IntType()

    def float_type(self, _: list[Any]) -> FableType:
        return FloatType()

    def date_type(self, _: list[Any]) -> FableType:
        return DateType()

    def datetime_type(self, _: list[Any]) -> FableType:
        return DatetimeType()

    def time_delta_type(self, _: list[Any]) -> FableType:
        return TimeDeltaType()

    def none_type(self, _: list[Any]) -> FableType:
        return NoneType()

    def parameter_type(self, _: list[Any]) -> FableType:
        return ParameterType()

    def artifact_type(self, _: list[Any]) -> FableType:
        return ArtifactType()

    def geo_domain_single_type(self, _: list[Any]) -> FableType:
        return GeoDomainSingleType()

    def geo_domain_type(self, _: list[Any]) -> FableType:
        return GeoDomainType()

    def bounding_box_wsen_type(self, _: list[Any]) -> FableType:
        return BoundingBoxWSENType()

    def enum_items(self, children: list[lark.Token]) -> list[str]:
        return [_enum_item_value(token) for token in children]

    def closed_enum_type(self, children: list[Any]) -> FableType:
        subtype, items = children
        return ClosedEnumType(items, subtype)

    def open_enum_type(self, children: list[Any]) -> FableType:
        subtype, items = children
        return OpenEnumType(items, subtype)

    def list_type(self, children: list[FableType]) -> FableType:
        return ListType(children[0])

    def union_type(self, children: list[FableType]) -> FableType:
        return UnionType(list(children))

    def traits(self, children: list[FableTrait]) -> list[FableTrait]:
        return list(children)

    def single_trait(self, children: list[FableTrait]) -> FableTrait:
        return children[0]

    def positive(self, _: list[Any]) -> FableTrait:
        return Positive()

    def non_negative(self, _: list[Any]) -> FableTrait:
        return NonNegative()

    def divisible_by(self, children: list[lark.Token]) -> FableTrait:
        return DivisibleBy(children[0].value)


class AstDumpTransformer(lark.Transformer[lark.Token, AstNode]):
    """Converts a parse tree of the Fable type grammar into a json-like AST.

    Every type node is a dict with a ``name`` key (the FableType class name without the ``Type``
    suffix), plus type-specific keys: ``item`` for List, ``types`` for Union, ``subtype`` and
    ``items`` (raw strings, unquoted) for ClosedEnum/OpenEnum. A ``traits`` key holds the list of
    traits, each a dict with a ``name`` and, for DivisibleBy, an ``arg`` (raw string), and is
    present only when the type has any traits. Enum items are not validated against the subtype.
    """

    def start(self, children: list[AstNode]) -> AstNode:
        return children[0]

    def fable_type(self, children: list[Any]) -> AstNode:
        node: AstNode = children[0]
        if len(children) > 1:
            node = {**node, "traits": children[1]}
        return node

    def string_type(self, _: list[Any]) -> AstNode:
        return {"name": "String"}

    def int_type(self, _: list[Any]) -> AstNode:
        return {"name": "Int"}

    def float_type(self, _: list[Any]) -> AstNode:
        return {"name": "Float"}

    def date_type(self, _: list[Any]) -> AstNode:
        return {"name": "Date"}

    def datetime_type(self, _: list[Any]) -> AstNode:
        return {"name": "Datetime"}

    def time_delta_type(self, _: list[Any]) -> AstNode:
        return {"name": "TimeDelta"}

    def none_type(self, _: list[Any]) -> AstNode:
        return {"name": "None"}

    def parameter_type(self, _: list[Any]) -> AstNode:
        return {"name": "Parameter"}

    def artifact_type(self, _: list[Any]) -> AstNode:
        return {"name": "Artifact"}

    def geo_domain_single_type(self, _: list[Any]) -> AstNode:
        return {"name": "GeoDomainSingle"}

    def geo_domain_type(self, _: list[Any]) -> AstNode:
        return {"name": "GeoDomain"}

    def bounding_box_wsen_type(self, _: list[Any]) -> AstNode:
        return {"name": "BoundingBoxWSEN"}

    def enum_items(self, children: list[lark.Token]) -> list[str]:
        return [_enum_item_value(token) for token in children]

    def closed_enum_type(self, children: list[Any]) -> AstNode:
        subtype, items = children
        return {"name": "ClosedEnum", "subtype": subtype, "items": items}

    def open_enum_type(self, children: list[Any]) -> AstNode:
        subtype, items = children
        return {"name": "OpenEnum", "subtype": subtype, "items": items}

    def list_type(self, children: list[AstNode]) -> AstNode:
        return {"name": "List", "item": children[0]}

    def union_type(self, children: list[AstNode]) -> AstNode:
        return {"name": "Union", "types": list(children)}

    def traits(self, children: list[AstNode]) -> list[AstNode]:
        return list(children)

    def single_trait(self, children: list[AstNode]) -> AstNode:
        return children[0]

    def positive(self, _: list[Any]) -> AstNode:
        return {"name": "Positive"}

    def non_negative(self, _: list[Any]) -> AstNode:
        return {"name": "NonNegative"}

    def divisible_by(self, children: list[lark.Token]) -> AstNode:
        return {"name": "DivisibleBy", "arg": children[0].value}


def _transform(tree: lark.Tree, transformer: lark.Transformer) -> Any:
    """Apply the transformer, re-raising any exception from within the transformer callbacks as is."""
    try:
        return transformer.transform(tree)
    except lark.exceptions.VisitError as e:
        raise e.orig_exc from None


def _longest_prefix(type_expr: str) -> int | None:
    """Length of the longest prefix of type_expr which is a complete type expression, or None if there is none."""
    interactive = _PARSER.parse_interactive(type_expr, start="start")
    end: int | None = None
    try:
        for token in interactive.lexer_thread.lex(interactive.parser_state):
            interactive.feed_token(token)
            if "$END" in interactive.accepts():
                end = token.end_pos
    except lark.exceptions.UnexpectedInput:
        pass
    return end


def _parse(type_expr: str) -> tuple[FableType, str]:
    """Parse a type expression from the start of type_expr.

    Returns ``(parsed_type, remainder)`` where ``remainder`` is the unparsed tail of the input
    string (with leading whitespace stripped) following the longest prefix which is a complete
    type expression. Raises NotFableType if no such prefix exists.
    """
    try:
        tree = _PARSER.parse(type_expr, start="start")
        return (_transform(tree, FableTypeTransformer()), "")
    except lark.exceptions.UnexpectedInput as e:
        end = _longest_prefix(type_expr)
        if end is None:
            raise NotFableType(f"Invalid type expression {type_expr!r}: {e}") from None
    tree = _PARSER.parse(type_expr[:end], start="start")
    return (_transform(tree, FableTypeTransformer()), type_expr[end:].lstrip())


def _parse_trait(trait_expr: str) -> FableTrait:
    """Parse a single trait expression, eg 'positive' or 'divisibleBy(3)'. Raises NotFableType if invalid."""
    try:
        tree = _PARSER.parse(trait_expr, start="single_trait")
    except lark.exceptions.UnexpectedInput as e:
        raise NotFableType(f"Invalid trait expression {trait_expr!r}: {e}") from None
    return _transform(tree, FableTypeTransformer())


def parse(type_expr: str | FableType) -> FableType:
    """Parse a complete Fable type expression. Raises ValueError if the expression is invalid."""
    if isinstance(type_expr, FableType):
        return type_expr
    if not isinstance(type_expr, str):
        raise ValueError(f"Expected a Fable type expression string, got {type(type_expr).__name__}")
    try:
        parsed, remainder = _parse(type_expr)
        if remainder:
            raise NotFableType(f"Unexpected trailing content in type expression: {remainder!r}")
    except NotFableType as exc:
        raise ValueError(str(exc)) from exc
    return parsed


def dump_ast(type_expr: str) -> AstNode:
    """Parse a complete Fable type expression into the json-like AST, see AstDumpTransformer.

    Raises ValueError if the expression is syntactically invalid.
    """
    try:
        tree = _PARSER.parse(type_expr, start="start")
    except lark.exceptions.UnexpectedInput as e:
        raise ValueError(f"Invalid type expression {type_expr!r}: {e}") from None
    return _transform(tree, AstDumpTransformer())

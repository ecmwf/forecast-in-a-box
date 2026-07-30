# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Structural checks on the blueprint templates this plugin ships.

A template that fails ingest-time validation is silently dropped from the
blueprint list, taking its card with it, so drift between a template and the
block it configures needs to fail here rather than at render time.

The semantic half of validation -- whether the requested params actually exist
in the source qube -- needs a live backend and is out of scope; everything
checkable without one is checked.
"""

import re
from collections.abc import Callable, Generator
from contextlib import AbstractContextManager as ContextManager

import pytest
from fiab_core.fable import BlockFactory, BlockInstanceId, BlueprintTemplate, ConfigurationOptionId
from fiab_core.types import WrongType, parse

from fiab_plugin_ecmwf import plugin

# Supplied by the runtime, not by the user, so they are never declared as example glyphs.
INTRINSIC_GLYPHS = {"runId", "submitDatetime", "startDatetime", "attemptCount"}

EXPECTED_ORDER = ["IFS Single-Member Snapshot", "AIFS 72-Hour Forecast", "IFS Ensemble Statistics"]

_GLYPH = re.compile(r"\$\{([^}]+)\}")

TEMPLATES = plugin().blueprint_templates
FACTORIES = plugin().catalogue.factories

# Templates may reference real, non-test checkpoint artifacts (e.g. the AIFS template's
# 'ecmwf:aifs-global-o48'). Register them alongside the shared dummy checkpoint so
# ArtifactType-typed options (like 'checkpoint') validate against something that knows them.
_TEMPLATE_CHECKPOINT_IDS = {
    str(value)
    for template in TEMPLATES
    for block in template.blocks.values()
    for option_id, value in block.instance.configuration_values.items()
    if option_id == ConfigurationOptionId("checkpoint") and not _GLYPH.search(str(value))
}


@pytest.fixture(scope="module", autouse=True)
def registered_provider(dummy_provider_factory: Callable[..., ContextManager[None]]) -> Generator[None, None, None]:
    """Overrides the shared fixture to additionally register the checkpoints these templates reference."""
    with dummy_provider_factory(extra_checkpoint_ids=_TEMPLATE_CHECKPOINT_IDS):
        yield


def _factory(template: BlueprintTemplate, block_id: BlockInstanceId) -> BlockFactory:
    return FACTORIES[template.blocks[block_id].factory_id]


def _leading_identifier(expression: str) -> str:
    """First identifier in a `${...}` body -- the glyph, before any filters."""
    return re.split(r"[^\w]", expression.strip(), maxsplit=1)[0]


def _glyph_names(value: str) -> set[str]:
    return {_leading_identifier(m) for m in _GLYPH.findall(value)}


ALL_BLOCKS = [(t, block_id) for t in TEMPLATES for block_id in t.blocks]
ALL_OPTIONS = [(t, block_id, option_id) for t, block_id in ALL_BLOCKS for option_id in t.blocks[block_id].instance.configuration_values]


def _id(param: object) -> str:
    return param.display_name if isinstance(param, BlueprintTemplate) else str(param)


def test_declares_the_expected_templates_in_order() -> None:
    # Declaration order is presentation order for clients offering starting points.
    assert [t.display_name for t in TEMPLATES] == EXPECTED_ORDER


def test_display_names_are_unique() -> None:
    # display_name is the upsert and exclusion key; duplicates would collide in the DB.
    names = [t.display_name for t in TEMPLATES]
    assert len(set(names)) == len(names)


@pytest.mark.parametrize("template", TEMPLATES, ids=_id)
def test_template_is_presentable(template: BlueprintTemplate) -> None:
    assert template.display_description
    assert template.tags, "tags render as chips wherever the template is offered"


@pytest.mark.parametrize(("template", "block_id"), ALL_BLOCKS, ids=_id)
def test_block_uses_a_factory_this_plugin_provides(template: BlueprintTemplate, block_id: BlockInstanceId) -> None:
    assert template.blocks[block_id].factory_id in FACTORIES


@pytest.mark.parametrize(("template", "block_id"), ALL_BLOCKS, ids=_id)
def test_block_inputs_are_declared_and_wired(template: BlueprintTemplate, block_id: BlockInstanceId) -> None:
    factory = _factory(template, block_id)
    for input_name, source_id in template.blocks[block_id].instance.input_ids.items():
        assert input_name in factory.inputs
        assert source_id in template.blocks


@pytest.mark.parametrize(("template", "block_id"), ALL_BLOCKS, ids=_id)
def test_block_supplies_every_option_without_a_default(template: BlueprintTemplate, block_id: BlockInstanceId) -> None:
    factory = _factory(template, block_id)
    supplied = template.blocks[block_id].instance.configuration_values
    missing = {oid for oid, option in factory.configuration_options.items() if option.default_value is None and oid not in supplied}
    assert not missing


@pytest.mark.parametrize(("template", "block_id", "option_id"), ALL_OPTIONS, ids=_id)
def test_option_is_known_to_its_factory(template: BlueprintTemplate, block_id: BlockInstanceId, option_id: ConfigurationOptionId) -> None:
    assert option_id in _factory(template, block_id).configuration_options


@pytest.mark.parametrize(("template", "block_id", "option_id"), ALL_OPTIONS, ids=_id)
def test_option_value_matches_its_type(template: BlueprintTemplate, block_id: BlockInstanceId, option_id: ConfigurationOptionId) -> None:
    """Glyph references resolve to their example value first, so both halves are covered."""
    raw = str(template.blocks[block_id].instance.configuration_values[option_id])
    if _glyph_names(raw) & INTRINSIC_GLYPHS:
        pytest.skip("intrinsic glyph -- the value only exists at run time")
    resolved = _GLYPH.sub(lambda m: template.example_glyphs[_leading_identifier(m.group(1))].example_value, raw)

    value_type = parse(_factory(template, block_id).configuration_options[option_id].value_type)
    try:
        value_type.validate_convert(resolved)
    except WrongType as exc:
        pytest.fail(f"{block_id}.{option_id} = {resolved!r} rejected by {value_type.serialize()}: {exc}")


@pytest.mark.parametrize("template", TEMPLATES, ids=_id)
def test_every_glyph_is_intrinsic_or_declared(template: BlueprintTemplate) -> None:
    """An undeclared glyph reaches the user as an unexplained blank field."""
    referenced: set[str] = set()
    for block in template.blocks.values():
        for value in block.instance.configuration_values.values():
            referenced |= _glyph_names(str(value))
    assert referenced - INTRINSIC_GLYPHS - set(template.example_glyphs) == set()


@pytest.mark.parametrize("template", TEMPLATES, ids=_id)
def test_every_declared_glyph_is_used(template: BlueprintTemplate) -> None:
    """An unused glyph asks the user for a value that changes nothing."""
    referenced: set[str] = set()
    for block in template.blocks.values():
        for value in block.instance.configuration_values.values():
            referenced |= _glyph_names(str(value))
    assert set(template.example_glyphs) - referenced == set()


@pytest.mark.parametrize("template", TEMPLATES, ids=_id)
def test_example_glyph_values_match_their_own_type_hint(template: BlueprintTemplate) -> None:
    for name, example in template.example_glyphs.items():
        assert example.display_name, f"{name} would otherwise show as a raw identifier"
        assert example.display_description
        assert example.type_hint is not None, (
            f"{name} must state its own type: templates are self-contained and the client "
            "does not infer types from the catalogue or from validation"
        )
        value_type = parse(example.type_hint)
        try:
            value_type.validate_convert(example.example_value)
        except WrongType as exc:
            pytest.fail(f"example glyph {name} = {example.example_value!r} rejected by {example.type_hint}: {exc}")


@pytest.mark.parametrize("template", TEMPLATES, ids=_id)
def test_templates_ship_no_local_glyphs(template: BlueprintTemplate) -> None:
    """`template_to_builder` drops example glyphs, so undefined references are what
    prompts the client for values. Pre-filling local_glyphs would suppress that."""
    assert template.local_glyphs == {}

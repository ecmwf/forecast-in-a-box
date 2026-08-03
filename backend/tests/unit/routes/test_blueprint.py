# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the blueprint route helpers."""

from forecastbox.domain.blueprint.service import CORE_VERSION_MISMATCH_TAG_KEY, Tag
from forecastbox.routes.blueprint import _maybe_append_coreversion_mismatch, tag_name_errors

# ---------------------------------------------------------------------------
# _maybe_append_coreversion_mismatch
# ---------------------------------------------------------------------------


def test_no_tag_when_versions_match() -> None:
    tags: list[Tag] = [Tag(key="foo")]
    _maybe_append_coreversion_mismatch(tags, entity_coreversion=1, current_coreversion=1)
    assert len(tags) == 1
    assert tags[0].key == "foo"


def test_appends_tag_when_versions_differ() -> None:
    tags: list[Tag] = []
    _maybe_append_coreversion_mismatch(tags, entity_coreversion=0, current_coreversion=1)
    assert len(tags) == 1
    assert tags[0].key == CORE_VERSION_MISMATCH_TAG_KEY
    assert tags[0].value == "!0 != 1"


def test_mismatch_message_uses_entity_version_first() -> None:
    tags: list[Tag] = []
    _maybe_append_coreversion_mismatch(tags, entity_coreversion=2, current_coreversion=5)
    assert tags[0].value == "!2 != 5"


def test_existing_tags_preserved_when_mismatch() -> None:
    tags: list[Tag] = [Tag(key="a"), Tag(key="b", value="v")]
    _maybe_append_coreversion_mismatch(tags, entity_coreversion=0, current_coreversion=1)
    assert len(tags) == 3
    assert tags[0].key == "a"
    assert tags[1].key == "b"
    assert tags[2].key == CORE_VERSION_MISMATCH_TAG_KEY


def test_no_tag_appended_on_zero_versions_match() -> None:
    tags: list[Tag] = []
    _maybe_append_coreversion_mismatch(tags, entity_coreversion=0, current_coreversion=0)
    assert tags == []


# ---------------------------------------------------------------------------
# Tag model
# ---------------------------------------------------------------------------


def test_tag_default_value_is_none() -> None:
    tag = Tag(key="label")
    assert tag.value is None


def test_tag_with_value() -> None:
    tag = Tag(key="k", value="v")
    assert tag.key == "k"
    assert tag.value == "v"


def test_tag_serializes_to_dict() -> None:
    tag = Tag(key="foo", value=None)
    d = tag.model_dump()
    assert d == {"key": "foo", "value": None}


def test_tag_roundtrip_via_model_validate() -> None:
    original = Tag(key="CoreVersionMismatch", value="!0 != 1")
    dumped = original.model_dump()
    restored = Tag.model_validate(dumped)
    assert restored == original


# ---------------------------------------------------------------------------
# tag_name_errors
# ---------------------------------------------------------------------------


def test_reject_reserved_tags_raises_on_reserved_key() -> None:
    tags = [Tag(key=CORE_VERSION_MISMATCH_TAG_KEY)]
    errors = tag_name_errors(tags)
    assert len(errors) == 1
    assert CORE_VERSION_MISMATCH_TAG_KEY in errors[0]


def test_reject_reserved_tags_passes_with_normal_tags() -> None:
    tags = [Tag(key="foo"), Tag(key="bar", value="baz")]
    assert tag_name_errors(tags) == []


def test_reject_reserved_tags_passes_for_empty_list() -> None:
    assert tag_name_errors([]) == []


def test_reject_reserved_tags_mixed_raises() -> None:
    tags = [Tag(key="ok"), Tag(key=CORE_VERSION_MISMATCH_TAG_KEY, value="!0 != 1")]
    errors = tag_name_errors(tags)
    assert len(errors) == 1
    assert CORE_VERSION_MISMATCH_TAG_KEY in errors[0]

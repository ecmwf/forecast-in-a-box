# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from unittest.mock import MagicMock

import pytest

from forecastbox.utility.git import get_all_repo_tags, get_highest_tag


def test_get_all_repo_tags_paginates() -> None:
    client = MagicMock()
    first = MagicMock()
    first.raise_for_status.return_value = None
    first.json.return_value = [{"name": "c0.0.7.0"}, {"name": "v1.0.0"}]

    second = MagicMock()
    second.raise_for_status.return_value = None
    second.json.return_value = []

    client.get.side_effect = [first, second]

    assert list(get_all_repo_tags(client)) == ["c0.0.7.0", "v1.0.0"]


@pytest.mark.parametrize(
    ("tags", "expected"),
    [
        (["c0.0.6.0", "c0.0.7.0", "c0.0.8.0"], "c0.0.8.0"),
        (["c1.0.0.0", "c0.9.9.9", "c1.0.0.1"], "c1.0.0.1"),
    ],
)
def test_get_highest_tag(tags: list[str], expected: str) -> None:
    assert get_highest_tag(iter(tags)) == expected


def test_get_highest_tag_ignores_non_c_tags() -> None:
    with pytest.raises(ValueError):
        get_highest_tag(iter(["v1.0.0", "d1.0.0"]))

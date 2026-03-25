# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from forecastbox.ecpyutil import deep_union


def test_deep_union_empty_dicts():
    assert deep_union({}, {}) == {}


def test_deep_union_dict1_empty():
    assert deep_union({}, {"a": 1, "b": {"c": 2}}) == {"a": 1, "b": {"c": 2}}


def test_deep_union_dict2_empty():
    assert deep_union({"a": 1, "b": {"c": 2}}, {}) == {"a": 1, "b": {"c": 2}}


def test_deep_union_no_conflicts():
    assert deep_union({"a": 1, "b": {"c": 2}}, {"d": 3, "e": 4}) == {"a": 1, "b": {"c": 2}, "d": 3, "e": 4}


def test_deep_union_with_conflicts_prefer_dict2():
    assert deep_union({"a": 1, "b": {"c": 2}, "k3": 0}, {"b": {"d": 3}, "k3": 4}) == {"a": 1, "b": {"c": 2, "d": 3}, "k3": 4}


def test_deep_union_nested_dicts_with_conflicts():
    assert deep_union({"k1": {"k2": 3}, "k3": 0}, {"k1": {"k4": 5}, "k3": 4}) == {"k1": {"k2": 3, "k4": 5}, "k3": 4}


def test_deep_union_non_dict_overwrite():
    assert deep_union({"a": 1, "b": {"c": 2}}, {"b": 3}) == {"a": 1, "b": 3}


def test_deep_union_dict_overwrite_non_dict():
    assert deep_union({"a": 1, "b": 2}, {"b": {"c": 3}}) == {"a": 1, "b": {"c": 3}}

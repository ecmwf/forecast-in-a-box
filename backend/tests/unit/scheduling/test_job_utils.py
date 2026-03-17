from datetime import datetime
from unittest.mock import patch

import orjson
import pytest

from forecastbox.api.scheduling.job_utils import deep_union, eval_dynamic_expression
from forecastbox.api.types.jobs import ExecutionSpecification
from forecastbox.schemas.schedule import ScheduleDefinition


def test_deep_union_empty_dicts():
    dict1 = {}
    dict2 = {}
    expected = {}
    assert deep_union(dict1, dict2) == expected


def test_deep_union_dict1_empty():
    dict1 = {}
    dict2 = {"a": 1, "b": {"c": 2}}
    expected = {"a": 1, "b": {"c": 2}}
    assert deep_union(dict1, dict2) == expected


def test_deep_union_dict2_empty():
    dict1 = {"a": 1, "b": {"c": 2}}
    dict2 = {}
    expected = {"a": 1, "b": {"c": 2}}
    assert deep_union(dict1, dict2) == expected


def test_deep_union_no_conflicts():
    dict1 = {"a": 1, "b": {"c": 2}}
    dict2 = {"d": 3, "e": 4}
    expected = {"a": 1, "b": {"c": 2}, "d": 3, "e": 4}
    assert deep_union(dict1, dict2) == expected


def test_deep_union_with_conflicts_prefer_dict2():
    dict1 = {"a": 1, "b": {"c": 2}, "k3": 0}
    dict2 = {"b": {"d": 3}, "k3": 4}
    expected = {"a": 1, "b": {"c": 2, "d": 3}, "k3": 4}
    assert deep_union(dict1, dict2) == expected


def test_deep_union_nested_dicts_with_conflicts():
    dict1 = {"k1": {"k2": 3}, "k3": 0}
    dict2 = {"k1": {"k4": 5}, "k3": 4}
    expected = {"k1": {"k2": 3, "k4": 5}, "k3": 4}
    assert deep_union(dict1, dict2) == expected


def test_deep_union_non_dict_overwrite():
    dict1 = {"a": 1, "b": {"c": 2}}
    dict2 = {"b": 3}
    expected = {"a": 1, "b": 3}
    assert deep_union(dict1, dict2) == expected


def test_deep_union_dict_overwrite_non_dict():
    dict1 = {"a": 1, "b": 2}
    dict2 = {"b": {"c": 3}}
    expected = {"a": 1, "b": {"c": 3}}
    assert deep_union(dict1, dict2) == expected


def test_eval_dynamic_expression_no_replacement():
    data = {"key1": "value1", "key2": 123}
    execution_time = datetime(2025, 10, 20, 10, 30)
    expected = {"key1": "value1", "key2": 123}
    assert eval_dynamic_expression(data, execution_time) == expected


def test_eval_dynamic_expression_single_replacement():
    data = {"key1": "$execution_time", "key2": "value2"}
    execution_time = datetime(2025, 10, 20, 10, 30)
    expected = {"key1": "20251020T10", "key2": "value2"}
    assert eval_dynamic_expression(data, execution_time) == expected


def test_eval_dynamic_expression_nested_replacement():
    data = {"key1": {"nested_key": "$execution_time"}, "key2": "value2"}
    execution_time = datetime(2025, 10, 20, 10, 30)
    expected = {"key1": {"nested_key": "20251020T10"}, "key2": "value2"}
    assert eval_dynamic_expression(data, execution_time) == expected


def test_eval_dynamic_expression_multiple_replacements():
    data = {"key1": "$execution_time", "key2": {"nested_key": "$execution_time"}}
    execution_time = datetime(2025, 10, 20, 10, 30)
    expected = {"key1": "20251020T10", "key2": {"nested_key": "20251020T10"}}
    assert eval_dynamic_expression(data, execution_time) == expected


def test_eval_dynamic_expression_partial_match():
    data = {"key1": "prefix_$execution_time_suffix", "key2": "$execution_time_only"}
    execution_time = datetime(2025, 10, 20, 10, 30)
    expected = {"key1": "prefix_$execution_time_suffix", "key2": "$execution_time_only"}
    assert eval_dynamic_expression(data, execution_time) == expected

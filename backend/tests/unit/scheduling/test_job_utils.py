from datetime import datetime

import pytest

from forecastbox.api.scheduling.job_utils import eval_dynamic_expression


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

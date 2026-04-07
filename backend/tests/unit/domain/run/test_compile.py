from forecastbox.domain.run.compile import merge_variable_values

# ---------------------------------------------------------------------------
# merge_variable_values
# ---------------------------------------------------------------------------


def test_merge_variable_values_automatic_only() -> None:
    result = merge_variable_values({"runId": "abc"}, {})
    assert result == {"runId": "abc"}


def test_merge_variable_values_context_only() -> None:
    result = merge_variable_values({}, {"date": "20260101T00"})
    assert result == {"date": "20260101T00"}


def test_merge_variable_values_context_overrides_automatic() -> None:
    result = merge_variable_values({"runId": "abc", "submitDatetime": "2026-01-01 00:00:00"}, {"runId": "custom"})
    assert result == {"runId": "custom", "submitDatetime": "2026-01-01 00:00:00"}


def test_merge_variable_values_both_combined() -> None:
    result = merge_variable_values({"runId": "abc"}, {"date": "20260101T00"})
    assert result == {"runId": "abc", "date": "20260101T00"}

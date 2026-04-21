from forecastbox.domain.glyphs.resolution import merge_glyph_values

# ---------------------------------------------------------------------------
# merge_glyph_values
# ---------------------------------------------------------------------------


def test_merge_glyph_values_intrinsic_only() -> None:
    result = merge_glyph_values({"runId": "abc"}, {}, {}, {})
    assert result == {"runId": "abc"}


def test_merge_glyph_values_context_only() -> None:
    result = merge_glyph_values({}, {}, {}, {"date": "20260101T00"})
    assert result == {"date": "20260101T00"}


def test_merge_glyph_values_context_overrides_intrinsic() -> None:
    result = merge_glyph_values({"runId": "abc", "submitDatetime": "2026-01-01 00:00:00"}, {}, {}, {"runId": "custom"})
    assert result == {"runId": "custom", "submitDatetime": "2026-01-01 00:00:00"}


def test_merge_glyph_values_all_combined() -> None:
    result = merge_glyph_values({"runId": "abc"}, {"globalKey": "globalVal"}, {}, {"date": "20260101T00"})
    assert result == {"runId": "abc", "globalKey": "globalVal", "date": "20260101T00"}


def test_merge_glyph_values_context_overrides_global() -> None:
    """context_values take precedence over global_values for the same key."""
    result = merge_glyph_values({}, {"sharedKey": "globalVal"}, {}, {"sharedKey": "contextVal"})
    assert result == {"sharedKey": "contextVal"}


def test_merge_glyph_values_global_overrides_intrinsic() -> None:
    """global_values take precedence over intrinsic_values (except pinned keys)."""
    result = merge_glyph_values({"runId": "abc"}, {"runId": "global_override"}, {}, {})
    assert result == {"runId": "global_override"}


def test_merge_glyph_values_start_datetime_not_overridable() -> None:
    """startDatetime from intrinsic_values always wins over any global or context value."""
    result = merge_glyph_values(
        {"startDatetime": "2026-01-01 12:00:00"},
        {"startDatetime": "global-value"},
        {"startDatetime": "local-value"},
        {"startDatetime": "2025-01-01 00:00:00"},
    )
    assert result == {"startDatetime": "2026-01-01 12:00:00"}


def test_merge_glyph_values_start_datetime_preserved_alongside_context() -> None:
    """startDatetime stays pinned to intrinsic even when other context overrides are applied."""
    result = merge_glyph_values(
        {"runId": "abc", "startDatetime": "2026-04-07 10:00:00", "submitDatetime": "2026-01-01 00:00:00"},
        {"globalKey": "gval"},
        {},
        {"runId": "custom", "startDatetime": "old-value", "date": "20260407T10"},
    )
    assert result["startDatetime"] == "2026-04-07 10:00:00"
    assert result["runId"] == "custom"
    assert result["date"] == "20260407T10"
    assert result["globalKey"] == "gval"


def test_merge_glyph_values_local_overrides_global() -> None:
    """local_values take precedence over global_values for the same key."""
    result = merge_glyph_values({}, {"sharedKey": "globalVal"}, {"sharedKey": "localVal"}, {})
    assert result == {"sharedKey": "localVal"}


def test_merge_glyph_values_context_overrides_local() -> None:
    """context_values take precedence over local_values for the same key."""
    result = merge_glyph_values({}, {}, {"sharedKey": "localVal"}, {"sharedKey": "contextVal"})
    assert result == {"sharedKey": "contextVal"}


def test_merge_glyph_values_local_not_overridable_for_pinned() -> None:
    """Local values cannot override pinned intrinsic keys like startDatetime."""
    result = merge_glyph_values(
        {"startDatetime": "2026-01-01 12:00:00"},
        {},
        {"startDatetime": "local-value"},
        {},
    )
    assert result == {"startDatetime": "2026-01-01 12:00:00"}

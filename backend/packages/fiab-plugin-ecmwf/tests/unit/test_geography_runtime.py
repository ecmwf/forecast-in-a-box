# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the argument handling of the geography regrid task, with MIR replaced by a recorder."""

from typing import Any

import pytest

from fiab_plugin_ecmwf.geography import runtime
from fiab_plugin_ecmwf.geography.runtime import BBox, regrid

# mir_backend imports earthkit-data at module level
pytest.importorskip("earthkit.data")

from fiab_plugin_ecmwf.geography import mir_backend  # noqa: E402
from fiab_plugin_ecmwf.geography.mir_backend import normalise_grid  # noqa: E402


class TestBBox:
    def test_format_reorders(self) -> None:
        bbox = BBox((-10.0, 35.0, 30.0, 60.0), fmt="wsen")

        assert bbox.format("nwse") == (60.0, -10.0, 35.0, 30.0)
        assert bbox.format("wesn") == (-10.0, 30.0, 35.0, 60.0)
        assert bbox.format("wsen") == (-10.0, 35.0, 30.0, 60.0)

    def test_format_roundtrip(self) -> None:
        bbox = BBox((60.0, -10.0, 35.0, 30.0), fmt="nwse")

        assert BBox(bbox.format("wsen"), fmt="wsen").format("nwse") == bbox.value

    @pytest.mark.parametrize("fmt", ["nws", "abcd", ""])
    def test_rejects_invalid_constructor_format(self, fmt: str) -> None:
        with pytest.raises(ValueError, match="format string"):
            BBox((60.0, -10.0, 35.0, 30.0), fmt=fmt)

    def test_rejects_invalid_output_format(self) -> None:
        with pytest.raises(ValueError, match="format string"):
            BBox((60.0, -10.0, 35.0, 30.0), fmt="nwse").format("nws")

    def test_rejects_wrong_length(self) -> None:
        with pytest.raises(ValueError, match="4 float"):
            BBox((60.0, -10.0, 35.0), fmt="nwse")  # type: ignore[arg-type]


class TestNormaliseGrid:
    @pytest.mark.parametrize(
        ("grid", "expected"),
        [
            (None, None),
            ("O96", "O96"),
            ("n320", "N320"),
            ("0.25/0.5", "0.25/0.5"),
            (0.25, "0.25/0.25"),
            (1, "1/1"),
            ([0.25, 0.5], "0.25/0.5"),
            ((1.0, 2.0), "1.0/2.0"),
        ],
    )
    def test_normalise_grid(self, grid: Any, expected: str | None) -> None:
        assert normalise_grid(grid) == expected


class TestRegridArguments:
    @pytest.fixture
    def calls(self, monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
        recorded: list[dict[str, Any]] = []

        def _mir_regrid(data: Any, grid: Any = None, area: Any = None, **kwargs: Any) -> str:
            recorded.append({"data": data, "grid": grid, "area": area})
            return "regridded"

        monkeypatch.setattr(runtime, "_ensure_mir_installed", lambda: None)
        monkeypatch.setattr(mir_backend, "mir_regrid", _mir_regrid)
        return recorded

    def test_no_domain_passes_no_area(self, calls: list[dict[str, Any]]) -> None:
        assert regrid("fields", grid="O96") == "regridded"  # type: ignore[arg-type]

        assert calls == [{"data": "fields", "grid": "O96", "area": None}]

    def test_list_domain_is_reordered_to_nwse(self, calls: list[dict[str, Any]]) -> None:
        regrid("fields", grid=0.25, domain=[-10.0, 35.0, 30.0, 60.0], fmt_if_list="wsen")  # type: ignore[arg-type]

        assert calls[0]["grid"] == 0.25
        assert calls[0]["area"] == [60.0, -10.0, 35.0, 30.0]

    def test_nwse_list_domain_is_passed_through(self, calls: list[dict[str, Any]]) -> None:
        regrid("fields", grid=[0.25, 0.5], domain=[60.0, -10.0, 35.0, 30.0], fmt_if_list="nwse")  # type: ignore[arg-type,invalid-argument-type]

        assert calls[0]["area"] == [60.0, -10.0, 35.0, 30.0]

    def test_string_domain_is_resolved_to_bbox(self, calls: list[dict[str, Any]], monkeypatch: pytest.MonkeyPatch) -> None:
        seen: list[str] = []

        def _bbox(identifier: str) -> BBox:
            seen.append(identifier)
            return BBox((55.0, 5.0, 47.0, 15.0), fmt="nwse")

        monkeypatch.setattr(runtime, "_get_bbox_from_string", _bbox)

        regrid("fields", grid="O96", domain="Germany")  # type: ignore[arg-type]

        assert seen == ["Germany"]
        assert calls[0]["area"] == [55.0, 5.0, 47.0, 15.0]

    def test_list_domain_requires_format(self, calls: list[dict[str, Any]]) -> None:
        with pytest.raises(ValueError, match="fmt_if_list"):
            regrid("fields", grid="O96", domain=[60.0, -10.0, 35.0, 30.0])  # type: ignore[arg-type,invalid-argument-type]

        assert calls == []

    def test_missing_mir_raises_runtime_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def _no_mir() -> None:
            raise RuntimeError("Cannot import `mir`")

        monkeypatch.setattr(runtime, "_ensure_mir_installed", _no_mir)

        with pytest.raises(RuntimeError, match="mir"):
            regrid("fields", grid="O96")  # type: ignore[arg-type]

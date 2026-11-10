# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the argument handling of the geography regrid task, with MIR replaced by a recorder."""

import sys
import types
from collections.abc import Sequence
from types import SimpleNamespace
from typing import Any

import pytest

from fiab_plugin_ecmwf.geography import runtime
from fiab_plugin_ecmwf.geography.extent import LatLonBox
from fiab_plugin_ecmwf.geography.runtime import BBox, regrid

# mir_backend imports earthkit-data at module level
pytest.importorskip("earthkit.data")

from fiab_plugin_ecmwf.geography import mir_backend  # noqa: E402
from fiab_plugin_ecmwf.geography.mir_backend import grid_repr  # noqa: E402


class TestBBox:
    def test_format_reorders(self) -> None:
        bbox = BBox((-10.0, 35.0, 30.0, 60.0), fmt="wsen")

        assert bbox.format("nwse") == (60.0, -10.0, 35.0, 30.0)
        assert bbox.format("wesn") == (-10.0, 30.0, 35.0, 60.0)
        assert bbox.format("wsen") == (-10.0, 35.0, 30.0, 60.0)

    def test_format_roundtrip(self) -> None:
        bbox = BBox((60.0, -10.0, 35.0, 30.0), fmt="nwse")

        assert BBox(bbox.format("wsen"), fmt="wsen").format("nwse") == bbox.value

    @pytest.mark.parametrize("fmt", ["nws", "nwsee", "nwsen", "nnws", "abcd", ""])
    def test_rejects_invalid_constructor_format(self, fmt: str) -> None:
        with pytest.raises(ValueError, match="format string"):
            BBox((60.0, -10.0, 35.0, 30.0), fmt=fmt)

    @pytest.mark.parametrize("fmt", ["nws", "nwsee", "nnws", ""])
    def test_rejects_invalid_output_format(self, fmt: str) -> None:
        with pytest.raises(ValueError, match="format string"):
            BBox((60.0, -10.0, 35.0, 30.0), fmt="nwse").format(fmt)

    def test_accepts_list_value(self) -> None:
        assert BBox([-10.0, 35.0, 30.0, 60.0], fmt="wsen").format("nwse") == (60.0, -10.0, 35.0, 30.0)

    def test_rejects_wrong_length(self) -> None:
        with pytest.raises(ValueError, match="4 float"):
            BBox((60.0, -10.0, 35.0), fmt="nwse")  # type: ignore[arg-type]


class _FakeMir:
    """Stands in for the mir module, recording what it is asked to build and execute."""

    def __init__(self) -> None:
        self.grids: list[dict[str, Any]] = []
        self.jobs: list[dict[str, Any]] = []
        self.executions: list[tuple[bytes, Any]] = []
        mir = self

        class Grid:
            def __init__(self, **kwargs: Any) -> None:
                mir.grids.append(kwargs)
                self.spec = dict(kwargs)

        class Job:
            def __init__(self, **kwargs: Any) -> None:
                mir.jobs.append(kwargs)

            def execute(self, source: Any, target: Any) -> None:
                mir.executions.append((source.buffer.read(), target))
                target.buffer.write(b"regridded")

        class PyGribInput:
            def __init__(self, buffer: Any) -> None:
                self.buffer = buffer

        class PyGribOutput:
            def __init__(self, buffer: Any) -> None:
                self.buffer = buffer

        self.Grid, self.Job, self.PyGribInput, self.PyGribOutput = Grid, Job, PyGribInput, PyGribOutput


@pytest.fixture
def fake_mir(monkeypatch: pytest.MonkeyPatch) -> _FakeMir:
    fake = _FakeMir()
    monkeypatch.setitem(sys.modules, "mir", fake)  # type: ignore[arg-type]
    return fake


class TestMakeMirGrid:
    @pytest.mark.parametrize(
        ("grid", "expected"),
        [
            ("O96", "O96"),
            ("n320", "N320"),
            ("0.25/0.5", "0.25/0.5"),
            ([0.25, 0.5], [0.25, 0.5]),
            ((1.0, 2.0), [1.0, 2.0]),
            ([1, 2], [1, 2]),
            (0.25, [0.25, 0.25]),
            (1, [1, 1]),
        ],
    )
    def test_grid_is_passed_to_mir(self, fake_mir: _FakeMir, grid: Any, expected: Any) -> None:
        assert mir_backend._make_mir_grid(grid).spec == {"grid": expected}

    def test_pair_order_is_passed_unchanged(self, fake_mir: _FakeMir) -> None:
        assert mir_backend._make_mir_grid([0.5, 1.0]).spec == {"grid": [0.5, 1.0]}
        assert mir_backend._make_mir_grid([1.0, 0.5]).spec == {"grid": [1.0, 0.5]}

    def test_dict_is_passed_as_keyword_arguments(self, fake_mir: _FakeMir) -> None:
        grid = {"latitudes": [0.0, 10.0], "longitudes": [5.0, 15.0]}

        assert mir_backend._make_mir_grid(grid).spec == grid

    @pytest.mark.parametrize("grid", [[1.0], [1.0, 2.0, 3.0], (), (1.0, 2.0, 3.0)])
    def test_rejects_wrong_number_of_resolutions(self, fake_mir: _FakeMir, grid: Any) -> None:
        with pytest.raises(ValueError, match="two resolutions"):
            mir_backend._make_mir_grid(grid)

    @pytest.mark.parametrize("grid", [None, True, object()])
    def test_rejects_unsupported_type(self, fake_mir: _FakeMir, grid: Any) -> None:
        with pytest.raises(ValueError, match="Unsupported grid"):
            mir_backend._make_mir_grid(grid)


class TestGridRepr:
    @pytest.mark.parametrize(
        ("grid", "expected"),
        [
            (None, "None"),
            ("n320", "N320"),
            ("O32", "O32"),
            ([0.25, 0.25], "[0.25, 0.25]"),
            ((0.5, 1.0), "[0.5, 1.0]"),
            (0.25, "0.25"),
        ],
    )
    def test_grid_repr(self, grid: Any, expected: str) -> None:
        assert grid_repr(grid) == expected

    def test_long_list_is_truncated(self) -> None:
        assert "..." in grid_repr([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0])

    def test_dict_is_summarised_by_length(self) -> None:
        result = grid_repr({"latitudes": [1.0, 2.0], "longitudes": [3.0, 4.0]})

        assert "latitudes" in result
        assert "list of len 2" in result


class _FakeField:
    def __init__(self, content: bytes) -> None:
        self.content = content

    def to_target(self, target: str, buffer: Any) -> None:
        assert target == "file"
        buffer.write(self.content)


class TestMirRegrid:
    @pytest.fixture
    def fields(self, fake_mir: _FakeMir, monkeypatch: pytest.MonkeyPatch) -> list[_FakeField]:
        fake_ekd = SimpleNamespace(
            from_source=lambda kind, data: [("regridded", data)],
            FieldList=SimpleNamespace(from_fields=lambda out_fields: list(out_fields)),
        )
        monkeypatch.setattr(mir_backend, "ekd", fake_ekd)
        return [_FakeField(b"first"), _FakeField(b"second")]

    def test_empty_fieldlist_is_returned_as_it_is(self, fake_mir: _FakeMir) -> None:
        empty: list[Any] = []

        assert mir_backend.mir_regrid(empty, grid="O48") is empty  # type: ignore[arg-type]
        assert fake_mir.jobs == []

    def test_job_gets_grid_spec_edition_packing_and_accuracy(self, fake_mir: _FakeMir, fields: list[_FakeField]) -> None:
        mir_backend.mir_regrid(fields, grid=[0.25, 0.5])  # type: ignore[arg-type]

        assert fake_mir.jobs == [{"edition": 2, "packing": "ccsds", "accuracy": 16, "grid": {"grid": [0.25, 0.5]}}]

    def test_job_gets_area_only_when_given(self, fake_mir: _FakeMir, fields: list[_FakeField]) -> None:
        mir_backend.mir_regrid(fields, grid="O48", area=[60.0, -10.0, 35.0, 30.0], packing="simple", accuracy=12)  # type: ignore[arg-type]

        assert fake_mir.jobs == [
            {"edition": 2, "packing": "simple", "accuracy": 12, "grid": {"grid": "O48"}, "area": [60.0, -10.0, 35.0, 30.0]},
        ]

    def test_one_job_executes_each_field_in_order(self, fake_mir: _FakeMir, fields: list[_FakeField]) -> None:
        result = mir_backend.mir_regrid(fields, grid="O48")  # type: ignore[arg-type]

        assert len(fake_mir.jobs) == 1
        assert [source for source, _ in fake_mir.executions] == [b"first", b"second"]
        assert result == [("regridded", b"regridded")] * 2

    def test_area_without_grid_cuts_out_only(self, fake_mir: _FakeMir, fields: list[_FakeField]) -> None:
        mir_backend.mir_regrid(fields, grid=None, area=[60.0, -10.0, 35.0, 30.0])  # type: ignore[arg-type]

        assert fake_mir.grids == []
        assert fake_mir.jobs == [{"edition": 2, "packing": "ccsds", "accuracy": 16, "area": [60.0, -10.0, 35.0, 30.0]}]

    @pytest.mark.parametrize("area", [None, []])
    def test_neither_grid_nor_area_returns_the_fields_unchanged(self, fake_mir: _FakeMir, fields: list[_FakeField], area: Any) -> None:
        assert mir_backend.mir_regrid(fields, grid=None, area=area) is fields  # type: ignore[arg-type]
        assert fake_mir.jobs == []
        assert fake_mir.executions == []


def _part(west: float, south: float, east: float, north: float) -> SimpleNamespace:
    return SimpleNamespace(bounds=(west, south, east, north))


class TestGetBboxFromNames:
    """The lookup of each name is replaced by fixed boxes, so only the combination is exercised."""

    @pytest.fixture
    def lookups(self, monkeypatch: pytest.MonkeyPatch) -> list[str]:
        boxes: dict[str, list[LatLonBox]] = {
            "Germany": [(54.98, 5.99, 47.30, 15.02)],
            "France": [(51.15, -4.59, 41.38, 9.56)],
            "Fiji": [(-16.02, 177.28, -18.29, 180.0), (-16.02, -180.0, -17.0, -178.0)],
            "Samoa": [(-13.4, -172.8, -14.1, -171.4)],
        }
        seen: list[str] = []

        def _boxes(identifier: str) -> list[LatLonBox]:
            seen.append(identifier)
            return boxes[identifier]

        monkeypatch.setattr(runtime, "_latlon_boxes_for_name", _boxes)
        return seen

    def test_looks_up_each_name_once(self, lookups: list[str]) -> None:
        runtime._get_bbox_from_names(["Germany", "France"])

        assert lookups == ["Germany", "France"]

    @pytest.mark.parametrize("names", [["Germany", "France"], ["France", "Germany"]])
    def test_union_is_the_extent_of_the_names_whatever_their_order(self, lookups: list[str], names: list[str]) -> None:
        bbox = runtime._get_bbox_from_names(names)

        assert bbox.fmt == "nwse"
        assert bbox.value == pytest.approx((54.98, -4.59, 41.38, 15.02))

    def test_single_name_is_its_own_extent(self, lookups: list[str]) -> None:
        assert runtime._get_bbox_from_names(["Germany"]).value == pytest.approx((54.98, 5.99, 47.30, 15.02))

    def test_names_either_side_of_the_180_line_give_a_box_across_it(self, lookups: list[str]) -> None:
        bbox = runtime._get_bbox_from_names(["Fiji", "Samoa"])

        north, west, south, east = bbox.value
        assert (north, south) == pytest.approx((-13.4, -18.29))
        assert west == pytest.approx(177.28)
        assert east == pytest.approx(360.0 - 171.4)
        assert east - west < 20.0


class TestLatLonBoxesForName:
    """The earthkit-plots lookups are replaced by fakes."""

    PRESETS: dict[str, Any] = {
        "Central Europe": [2, 24, 45, 55],
        "Europe": {"bounds": [2502500, 7497500, 752500, 5497500], "crs": {"name": "LambertAzimuthalEqualArea"}},
    }
    SHAPES: dict[str, Any] = {
        "France": SimpleNamespace(geoms=[_part(-4.59, 42.3, 8.1, 51.1), _part(8.5, 41.4, 9.6, 43.0)]),
        "Russian Federation": _part(19.6, 41.1, 190.1, 81.2),
    }
    ALIASES = {"russia": "Russian Federation"}

    @pytest.fixture
    def earthkit_plots(self, monkeypatch: pytest.MonkeyPatch) -> dict[str, list[str]]:
        calls: dict[str, list[str]] = {"from_string": [], "shape": []}

        def _format_name(name: str) -> str | None:
            if name in self.PRESETS:
                return name
            return self.ALIASES.get(name.lower())

        class _Domain:
            def __init__(self, can_bbox: bool) -> None:
                self.can_bbox = can_bbox
                self.bbox = SimpleNamespace(to_latlon_bbox=lambda: SimpleNamespace(north=71.0, west=-35.0, south=24.0, east=74.0))

            @classmethod
            def from_string(cls, name: str) -> "_Domain":
                calls["from_string"].append(name)
                return cls(can_bbox=name != "Arctic")

        class _NaturalEarthDomain:
            def __init__(self, name: str) -> None:
                calls["shape"].append(name)
                self.name = name

            @property
            def geometry(self) -> Any:
                if self.name == "Broken":
                    raise AttributeError("no record")
                return TestLatLonBoxesForName.SHAPES[self.name]

        for module_name, attributes in {
            "earthkit.plots.ancillary": {"load": lambda source, data_type=None: {"domains": self.PRESETS}},
            "earthkit.plots.geo.domains": {"Domain": _Domain, "format_name": _format_name},
            "earthkit.plots.geo.natural_earth": {"NaturalEarthDomain": _NaturalEarthDomain},
        }.items():
            module = types.ModuleType(module_name)
            for attribute, value in attributes.items():
                setattr(module, attribute, value)
            monkeypatch.setitem(sys.modules, module_name, module)
        return calls

    def test_plain_preset_gives_its_configured_box(self, earthkit_plots: dict[str, list[str]]) -> None:
        assert runtime._latlon_boxes_for_name("Central Europe") == [(55.0, 2.0, 45.0, 24.0)]
        assert earthkit_plots["from_string"] == ["Central Europe"]
        assert earthkit_plots["shape"] == []

    def test_projected_preset_falls_back_to_the_projected_bounding_box(self, earthkit_plots: dict[str, list[str]]) -> None:
        assert runtime._latlon_boxes_for_name("Europe") == [(71.0, -35.0, 24.0, 74.0)]

    def test_country_gives_the_box_of_each_part_of_its_shape(self, earthkit_plots: dict[str, list[str]]) -> None:
        assert runtime._latlon_boxes_for_name("France") == [(51.1, -4.59, 42.3, 8.1), (43.0, 8.5, 41.4, 9.6)]
        assert earthkit_plots["from_string"] == ["France"]

    def test_alias_looks_up_the_shape_by_its_canonical_name(self, earthkit_plots: dict[str, list[str]]) -> None:
        assert runtime._latlon_boxes_for_name("Russia") == [(81.2, 19.6, 41.1, 190.1)]
        assert earthkit_plots["shape"] == ["Russian Federation"]

    def test_unreadable_shape_falls_back_to_the_projected_bounding_box(
        self, earthkit_plots: dict[str, list[str]], caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level("WARNING"):
            boxes = runtime._latlon_boxes_for_name("Broken")

        assert boxes == [(71.0, -35.0, 24.0, 74.0)]
        assert "Broken" in caplog.text

    @pytest.mark.parametrize("missing", ["earthkit.plots.ancillary", "earthkit.plots.geo.natural_earth", "format_name"])
    def test_unavailable_internals_fall_back_to_the_projected_bounding_box(
        self,
        earthkit_plots: dict[str, list[str]],
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        missing: str,
    ) -> None:
        if missing == "format_name":
            monkeypatch.delattr(sys.modules["earthkit.plots.geo.domains"], "format_name")
        else:
            monkeypatch.setitem(sys.modules, missing, None)

        with caplog.at_level("WARNING"):
            boxes = runtime._latlon_boxes_for_name("France")

        assert boxes == [(71.0, -35.0, 24.0, 74.0)]
        assert earthkit_plots["from_string"] == ["France"]
        assert "France" in caplog.text

    def test_missing_domain_class_is_an_error(self, earthkit_plots: dict[str, list[str]], monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setitem(sys.modules, "earthkit.plots.geo.domains", None)

        with pytest.raises(RuntimeError, match="Cannot import `earthkit-plots"):
            runtime._latlon_boxes_for_name("France")

    def test_rejects_domain_that_cannot_be_a_bbox(self, earthkit_plots: dict[str, list[str]]) -> None:
        with pytest.raises(RuntimeError, match="cannot be used as a bounding box"):
            runtime._latlon_boxes_for_name("Arctic")


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

    @pytest.fixture
    def lookups(self, monkeypatch: pytest.MonkeyPatch) -> list[list[str]]:
        seen: list[list[str]] = []

        def _bbox(identifiers: Sequence[str]) -> BBox:
            seen.append(list(identifiers))
            return BBox((55.0, 5.0, 47.0, 15.0), fmt="nwse")

        monkeypatch.setattr(runtime, "_get_bbox_from_names", _bbox)
        return seen

    def test_string_domain_is_resolved_to_bbox(self, calls: list[dict[str, Any]], lookups: list[list[str]]) -> None:
        regrid("fields", grid="O96", domain="Germany")  # type: ignore[arg-type]

        assert lookups == [["Germany"]]
        assert calls[0]["area"] == [55.0, 5.0, 47.0, 15.0]

    @pytest.mark.parametrize("names", [["Germany"], ["Germany", "France"], ["France", "Germany", "Italy"]])
    def test_name_list_is_resolved_with_one_lookup_in_order(
        self, calls: list[dict[str, Any]], lookups: list[list[str]], names: list[str]
    ) -> None:
        regrid("fields", grid="O96", domain=names)  # type: ignore[arg-type]

        assert lookups == [names]
        assert calls[0]["area"] == [55.0, 5.0, 47.0, 15.0]

    def test_name_list_does_not_need_format(self, calls: list[dict[str, Any]], lookups: list[list[str]]) -> None:
        regrid("fields", grid="O96", domain=["Germany", "France"], fmt_if_list=None)  # type: ignore[arg-type]

        assert len(calls) == 1

    @pytest.mark.parametrize("domain", [["Germany", 5.0], [60.0, "Germany"], [True, 1.0, 2.0, 3.0]])
    def test_mixed_domain_list_is_rejected(self, calls: list[dict[str, Any]], lookups: list[list[str]], domain: Any) -> None:
        with pytest.raises(TypeError, match="only names or only numbers"):
            regrid("fields", grid="O96", domain=domain, fmt_if_list="nwse")  # type: ignore[arg-type]

        assert calls == []
        assert lookups == []

    def test_number_list_does_not_use_lookup(self, calls: list[dict[str, Any]], lookups: list[list[str]]) -> None:
        regrid("fields", grid="O96", domain=[60, -10, 35, 30], fmt_if_list="nwse")  # type: ignore[arg-type]

        assert lookups == []
        assert calls[0]["area"] == [60, -10, 35, 30]

    @pytest.mark.parametrize("grid", [[0.5, 1.0], 0.25, "N320", None])
    def test_grid_is_passed_unchanged(self, calls: list[dict[str, Any]], grid: Any) -> None:
        regrid("fields", grid=grid)  # type: ignore[arg-type]

        assert calls[0]["grid"] == grid

    @pytest.mark.parametrize("fmt_if_list", [None, "nwse"])
    def test_empty_list_domain_only_regrids(self, calls: list[dict[str, Any]], fmt_if_list: str | None) -> None:
        regrid("fields", grid=[0.5, 1.0], domain=[], fmt_if_list=fmt_if_list)  # type: ignore[arg-type]

        assert calls == [{"data": "fields", "grid": [0.5, 1.0], "area": None}]

    @pytest.mark.parametrize("domain", [(60.0, -10.0, 35.0, 30.0), 5, {"north": 60.0}])
    def test_unsupported_domain_type_is_rejected(self, calls: list[dict[str, Any]], domain: Any) -> None:
        with pytest.raises(TypeError, match="`domain` must be"):
            regrid("fields", grid="O96", domain=domain, fmt_if_list="nwse")  # type: ignore[arg-type]

        assert calls == []

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

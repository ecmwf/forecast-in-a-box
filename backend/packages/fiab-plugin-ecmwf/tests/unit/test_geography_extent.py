# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the union of latitude and longitude boxes."""

import itertools
from types import SimpleNamespace

import pytest

from fiab_plugin_ecmwf.geography.extent import LatLonBox, box_from_preset, boxes_from_geometry, union_boxes

GERMANY: LatLonBox = (54.98, 5.99, 47.30, 15.02)
FRANCE: LatLonBox = (51.15, -4.59, 41.38, 9.56)
# the longitudes of Russia run from 19.6 east, over the 180 line, to the Chukotka coast
RUSSIA_MAINLAND: LatLonBox = (81.25, 19.66, 41.15, 180.0)
RUSSIA_CHUKOTKA: LatLonBox = (71.5, -180.0, 62.0, -169.9)
UNITED_STATES: LatLonBox = (71.36, -171.79, 18.92, -66.96)


class TestUnionBoxes:
    def test_single_box_is_unchanged(self) -> None:
        assert union_boxes([GERMANY]) == pytest.approx(GERMANY)

    def test_single_box_across_the_180_line_is_unchanged(self) -> None:
        fiji = (-16.0, 177.3, -18.3, 180.2)

        assert union_boxes([fiji]) == pytest.approx(fiji)

    def test_single_box_given_with_west_greater_than_east(self) -> None:
        assert union_boxes([(10.0, 170.0, -10.0, -170.0)]) == pytest.approx((10.0, 170.0, -10.0, 190.0))

    def test_latitudes_are_minimum_south_and_maximum_north(self) -> None:
        north, _, south, _ = union_boxes([GERMANY, FRANCE])

        assert north == GERMANY[0]
        assert south == FRANCE[2]

    def test_overlapping_boxes_give_their_longitude_extent(self) -> None:
        assert union_boxes([GERMANY, FRANCE]) == pytest.approx((54.98, -4.59, 41.38, 15.02))

    def test_disjoint_boxes_leave_out_the_largest_gap(self) -> None:
        assert union_boxes([(10.0, 0.0, 0.0, 10.0), (10.0, 40.0, 0.0, 50.0)]) == pytest.approx((10.0, 0.0, 0.0, 50.0))

    @pytest.mark.parametrize("boxes", itertools.permutations([GERMANY, FRANCE, UNITED_STATES, RUSSIA_MAINLAND, RUSSIA_CHUKOTKA], 5))
    def test_order_does_not_matter(self, boxes: tuple[LatLonBox, ...]) -> None:
        reference = union_boxes([GERMANY, FRANCE, UNITED_STATES, RUSSIA_MAINLAND, RUSSIA_CHUKOTKA])

        assert union_boxes(list(boxes)) == reference

    def test_boxes_either_side_of_the_180_line_give_a_box_across_it(self) -> None:
        east_of_line: LatLonBox = (10.0, 170.0, 0.0, 175.0)
        west_of_line: LatLonBox = (5.0, -175.0, -5.0, -170.0)

        result = union_boxes([east_of_line, west_of_line])

        assert result == pytest.approx((10.0, 170.0, -5.0, 190.0))
        assert union_boxes([west_of_line, east_of_line]) == result

    def test_boxes_touching_at_the_180_line_are_joined(self) -> None:
        result = union_boxes([(10.0, 170.0, 0.0, 180.0), (10.0, -180.0, 0.0, -170.0)])

        assert result == pytest.approx((10.0, 170.0, 0.0, 190.0))

    def test_russia_and_united_states_leave_out_the_gap_over_europe(self) -> None:
        north, west, south, east = union_boxes([RUSSIA_MAINLAND, RUSSIA_CHUKOTKA, UNITED_STATES])

        assert (north, south) == pytest.approx((81.25, 18.92))
        assert west == pytest.approx(19.66)
        assert east == pytest.approx(360.0 - 66.96)

    def test_result_longitude_span_is_the_smallest_that_covers_the_boxes(self) -> None:
        # the covering arcs 10 to 20, 100 to 110 and 200 to 210 leave gaps of 80, 90 and 160, so the 160 degree gap is left out
        boxes: list[LatLonBox] = [(1.0, 10.0, 0.0, 20.0), (1.0, 100.0, 0.0, 110.0), (1.0, 200.0, 0.0, 210.0)]

        assert union_boxes(boxes) == pytest.approx((1.0, 10.0, 0.0, 210.0))

    def test_full_circle_given_by_one_box(self) -> None:
        assert union_boxes([(90.0, -180.0, -90.0, 180.0)]) == (90.0, -180.0, -90.0, 180.0)

    def test_full_circle_given_by_a_box_of_360_degrees_from_another_origin(self) -> None:
        assert union_boxes([(10.0, 0.0, -10.0, 360.0)]) == (10.0, -180.0, -10.0, 180.0)

    def test_full_circle_given_by_boxes_covering_every_longitude(self) -> None:
        boxes: list[LatLonBox] = [(10.0, -180.0, 0.0, -60.0), (20.0, -60.0, -5.0, 60.0), (5.0, 60.0, 1.0, 180.0)]

        assert union_boxes(boxes) == (20.0, -180.0, -5.0, 180.0)

    def test_full_circle_given_by_overlapping_boxes_across_the_origin(self) -> None:
        boxes: list[LatLonBox] = [(10.0, 100.0, 0.0, 300.0), (10.0, 290.0, 0.0, 460.0)]

        assert union_boxes(boxes) == (10.0, -180.0, 0.0, 180.0)

    def test_box_with_gap_just_below_the_tolerance_counts_as_full_circle(self) -> None:
        boxes: list[LatLonBox] = [(10.0, 0.0, 0.0, 180.0), (10.0, 180.0 + 1e-12, 0.0, 360.0)]

        assert union_boxes(boxes) == (10.0, -180.0, 0.0, 180.0)

    def test_west_is_in_the_half_open_range_from_minus_180(self) -> None:
        for box in [(1.0, 0.0, 0.0, 10.0), (1.0, 190.0, 0.0, 200.0), (1.0, -190.0, 0.0, -180.0), (1.0, 350.0, 0.0, 359.0)]:
            _, west, _, east = union_boxes([box])
            assert -180.0 <= west < 180.0
            assert east >= west

    def test_empty_input_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="no boxes"):
            union_boxes([])


class TestBoxFromPreset:
    def test_list_preset_is_west_east_south_north(self) -> None:
        assert box_from_preset([2, 24, 45, 55]) == (55.0, 2.0, 45.0, 24.0)

    def test_preset_with_east_above_180(self) -> None:
        assert box_from_preset([105, 240, -50, 30]) == (30.0, 105.0, -50.0, 240.0)

    def test_swapped_latitudes_are_ordered(self) -> None:
        assert box_from_preset([-87, -32, 17, -57]) == (17.0, -87.0, -57.0, -32.0)

    def test_plate_carree_preset_is_plain_latitude_and_longitude(self) -> None:
        assert box_from_preset({"bounds": [30, 179, -20, 80], "crs": {"name": "PlateCarree"}}) == (80.0, 30.0, -20.0, 179.0)

    @pytest.mark.parametrize(
        "config",
        [
            {"bounds": [2502500, 7497500, 752500, 5497500], "crs": {"name": "LambertAzimuthalEqualArea", "central_latitude": 52}},
            {"bounds": [-4000000, 4000000, -4000000, 4000000], "crs": {"name": "NorthPolarStereo"}},
            {"bounds": [30, 179, -20, 80], "crs": {"name": "PlateCarree", "central_longitude": 180}},
            {"bounds": [30, 179, -20, 80]},
            {"crs": {"name": "PlateCarree"}},
            [1, 2, 3],
            "Europe",
            None,
        ],
    )
    def test_other_presets_give_none(self, config: object) -> None:
        assert box_from_preset(config) is None


class TestBoxesFromGeometry:
    def test_single_geometry(self) -> None:
        geometry = SimpleNamespace(bounds=(5.99, 47.30, 15.02, 54.98))

        assert boxes_from_geometry(geometry) == [(54.98, 5.99, 47.30, 15.02)]

    def test_multi_part_geometry_gives_a_box_per_part(self) -> None:
        geometry = SimpleNamespace(
            geoms=[SimpleNamespace(bounds=(-4.6, 42.3, 8.1, 51.1)), SimpleNamespace(bounds=(8.5, 41.4, 9.6, 43.0))],
            bounds=(-4.6, 41.4, 9.6, 51.1),
        )

        assert boxes_from_geometry(geometry) == [(51.1, -4.6, 42.3, 8.1), (43.0, 8.5, 41.4, 9.6)]

    def test_parts_either_side_of_the_180_line_join_into_a_tight_arc(self) -> None:
        geometry = SimpleNamespace(
            geoms=[SimpleNamespace(bounds=(177.3, -18.3, 180.0, -16.1)), SimpleNamespace(bounds=(-180.0, -16.6, -179.8, -16.0))]
        )

        north, west, south, east = union_boxes(boxes_from_geometry(geometry))

        assert (north, south) == pytest.approx((-16.0, -18.3))
        assert (west, east) == pytest.approx((177.3, 180.2))

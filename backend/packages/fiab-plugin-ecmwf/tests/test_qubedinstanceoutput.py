"""
Tests for QubedOutput and qubed_utils

QubedOutput represents the output produced by a BlockInstance, consisting of dataqube and metadata.
"""

import typing

import pytest
from fiab_core.fable import QubedOutput
from qubed import Qube

from fiab_plugin_ecmwf.qubed_utils import axes, collapse, contains, coxpand, dimensions, expand


@pytest.fixture
def empty_output():
    """Create an empty QubedOutput"""
    return QubedOutput()


@pytest.fixture
def simple_output():
    """Create a simple QubedOutput with param and time dimensions"""
    return QubedOutput(
        dataqube=Qube.from_datacube(
            {
                "param": ["2t", "tp"],
                "time": [0, 1, 2],
            }
        )
    )


@pytest.fixture
def complex_output():
    """Create a complex QubedOutput with param, time, and level dimensions"""
    return QubedOutput(
        dataqube=Qube.from_datacube(
            {
                "param": ["t", "q"],
                "time": [0, 1, 2],
                "level": [1000, 850, 700],
            }
        )
    )


class TestQubedOutputCreation:
    """Tests for creating QubedOutput instances"""

    @pytest.mark.parametrize(
        "fixture_name,expected_dimensions",
        [
            ("empty_output", set()),
            ("simple_output", {"param", "time"}),
            ("complex_output", {"param", "time", "level"}),
        ],
    )
    def test_creation_with_dimensions(self, fixture_name, expected_dimensions, request):
        """Test creating QubedOutput with various dimensions"""
        output = request.getfixturevalue(fixture_name)
        assert dimensions(output) == expected_dimensions
        assert output.datatype == ""


class TestQubedOutputExpand:
    """Tests for the expand() method"""

    def test_expand_from_empty(self, empty_output):
        """Test expanding from an empty output"""
        expanded = expand(empty_output, {"param": ["t", "q"]})
        assert dimensions(expanded) == {"param"}
        assert set(axes(expanded)["param"]) == {"t", "q"}

    def test_expand_multiple_dimensions(self, simple_output):
        """Test expanding with multiple dimensions at once"""
        expanded = expand(
            simple_output,
            {
                "ensemble": ["ens1", "ens2"],
                "level": [1000, 850],
            },
        )
        assert dimensions(expanded) == {"param", "time", "ensemble", "level"}
        assert set(axes(expanded)["ensemble"]) == {"ens1", "ens2"}
        assert set(axes(expanded)["level"]) == {1000, 850}

    @pytest.mark.parametrize("fixture_name", ["empty_output", "simple_output", "complex_output"])
    def test_expand_preserves_original(self, fixture_name, request):
        """Test that expand preserves the original output across all fixture types"""
        output = request.getfixturevalue(fixture_name)
        original_dims = dimensions(output)
        original_axes = axes(output)

        expanded = expand(output, {"ensemble": ["ens1", "ens2"]})

        assert dimensions(output) == original_dims
        assert axes(output) == original_axes
        assert not contains(output, "ensemble")
        assert contains(expanded, "ensemble")

    def test_expand_chain(self, empty_output):
        """Test chaining multiple expand operations"""
        output = expand(empty_output, {"param": ["t"]})
        output = expand(output, {"time": [0, 1]})
        output = expand(output, {"level": [1000]})

        assert dimensions(output) == {"param", "time", "level"}

    @pytest.mark.parametrize(
        "fixture_name,dimension_values",
        [
            ("empty_output", ["val1"]),
            ("simple_output", ["val1", "val2"]),
            ("complex_output", ["val1", "val2", "val3", "val4", "val5"]),
        ],
    )
    def test_expand_with_varying_value_counts(self, fixture_name, dimension_values, request):
        """Test expanding with different numbers of values across fixtures"""
        output = request.getfixturevalue(fixture_name)
        expanded = expand(output, {"new_dim": dimension_values})
        assert contains(expanded, "new_dim")
        assert set(axes(expanded)["new_dim"]) == set(dimension_values)

    @pytest.mark.parametrize("fixture_name", ["empty_output", "simple_output", "complex_output"])
    def test_expand_with_empty_dict(self, fixture_name, request):
        """Test expanding with an empty dictionary preserves state"""
        output = request.getfixturevalue(fixture_name)
        original_dims = dimensions(output)
        expanded = expand(output, {})
        assert dimensions(expanded) == original_dims

    @pytest.mark.parametrize(
        "fixture_name,dimension_name",
        [
            ("simple_output", "param"),
            ("complex_output", "level"),
        ],
    )
    def test_expand_existing_dimension(self, fixture_name, dimension_name, request):
        """Test expanding with a dimension that already exists"""
        output = request.getfixturevalue(fixture_name)
        expanded = expand(output, {dimension_name: ["new1", "new2"]})
        assert contains(expanded, dimension_name)
        assert dimensions(expanded) >= dimensions(output)


class TestQubedOutputCollapse:
    """Tests for the collapse() method"""

    @pytest.mark.parametrize(
        "fixture_name,dimensions_to_collapse,expected_dims",
        [
            ("complex_output", "level", {"param", "time"}),
            ("complex_output", ["level", "time"], {"param"}),
            ("simple_output", ["param", "time"], set()),
            ("complex_output", ["param", "time", "level"], set()),
        ],
    )
    def test_collapse_dimensions(self, fixture_name, dimensions_to_collapse, expected_dims, request):
        """Test collapsing single and multiple dimensions"""
        output = request.getfixturevalue(fixture_name)
        collapsed = collapse(output, dimensions_to_collapse)
        assert dimensions(collapsed) == expected_dims

    @pytest.mark.parametrize("fixture_name", ["simple_output", "complex_output"])
    def test_collapse_preserves_original(self, fixture_name, request):
        """Test that collapse preserves the original output across fixtures"""
        output = request.getfixturevalue(fixture_name)
        original_dims = dimensions(output)
        original_axes = axes(output)

        first_dim = list(dimensions(output))[0]
        collapsed = collapse(output, first_dim)

        assert dimensions(output) == original_dims
        assert axes(output) == original_axes
        assert contains(output, first_dim)
        assert not contains(collapsed, first_dim)

    @pytest.mark.parametrize(
        "fixture_name,invalid_dimension",
        [
            ("empty_output", "level"),
            ("simple_output", "level"),
            ("complex_output", "ensemble"),
        ],
    )
    def test_collapse_nonexistent_dimension_raises(self, fixture_name, invalid_dimension, request):
        """Test that collapsing a nonexistent dimension raises ValueError"""
        output = request.getfixturevalue(fixture_name)
        with pytest.raises(ValueError, match=f"Dimension '{invalid_dimension}' not in dataqube dimensions"):
            collapse(output, invalid_dimension)

    def test_collapse_chain(self, complex_output):
        """Test chaining multiple collapse operations"""
        output = collapse(collapse(complex_output, "level"), "time")
        assert dimensions(output) == {"param"}

    @pytest.mark.parametrize(
        "fixture_name,expand_dimension,collapse_dimension",
        [
            ("empty_output", {"level": [1000, 850]}, "level"),
            ("simple_output", {"ensemble": ["ens1", "ens2"]}, "ensemble"),
        ],
    )
    def test_expand_then_collapse_roundtrip(self, fixture_name, expand_dimension, collapse_dimension, request):
        """Test expanding then collapsing returns to original state"""
        output = request.getfixturevalue(fixture_name)
        expanded = expand(output, expand_dimension)
        collapsed = collapse(expanded, collapse_dimension)

        assert dimensions(collapsed) == dimensions(output)
        assert axes(collapsed) == axes(output)

    @pytest.mark.parametrize(
        "fixture_name,collapse_dimension,expand_dimension",
        [
            ("simple_output", "param", {"param": ["t", "q"]}),
            ("complex_output", "level", {"level": [1000, 850, 700]}),
        ],
    )
    def test_collapse_then_expand_roundtrip(self, fixture_name, collapse_dimension, expand_dimension, request):
        """Test collapsing then expanding with same dimension"""
        output = request.getfixturevalue(fixture_name)
        collapsed = collapse(output, collapse_dimension)
        expanded = expand(collapsed, expand_dimension)
        assert dimensions(expanded) == dimensions(output)

    @pytest.mark.parametrize("fixture_name", ["simple_output", "complex_output"])
    def test_collapse_same_dimension_twice(self, fixture_name, request):
        """Test that collapsing the same dimension twice raises error"""
        output = request.getfixturevalue(fixture_name)
        first_dim = list(dimensions(output))[0]
        collapsed = collapse(output, first_dim)

        with pytest.raises(ValueError):
            collapse(collapsed, first_dim)


class TestQubedOutputContains:
    """Tests for the __contains__ method"""

    @pytest.mark.parametrize(
        "fixture_name,dimension,expected",
        [
            ("simple_output", "param", True),
            ("simple_output", "time", True),
            ("simple_output", "level", False),
            ("empty_output", "param", False),
        ],
    )
    def test_contains_dimension_string(self, fixture_name, dimension, expected, request):
        """Test checking if a dimension exists using string"""
        output = request.getfixturevalue(fixture_name)
        assert contains(output, dimension) == expected

    @pytest.mark.parametrize("fixture_name", ["empty_output", "simple_output", "complex_output"])
    def test_contains_empty_dict(self, fixture_name, request):
        """Test that empty dict is always contained"""
        output = request.getfixturevalue(fixture_name)
        assert contains(output, {})

    @pytest.mark.parametrize(
        "subset,expected",
        [
            ({"param": ["2t"]}, True),
            ({"param": ["tp"]}, True),
            ({"param": ["2t", "tp"]}, True),
            ({"param": ["invalid"]}, False),
            ({"time": [0]}, True),
            ({"time": [0, 1, 2]}, True),
            ({"time": [99]}, False),
            ({"param": ["2t"], "time": [0]}, True),
            ({"param": ["2t"], "time": [99]}, False),
        ],
    )
    def test_contains_various_subsets(self, simple_output, subset, expected):
        """Test contains with various subset combinations"""
        assert contains(simple_output, subset) == expected

    def test_contains_subset_after_expand_collapse(self):
        """Test checking if a subset exists after expand and collapse"""
        output = QubedOutput(
            dataqube=Qube.from_datacube(
                {
                    "param": ["t", "q"],
                    "time": [0, 1, 2],
                    "level": [1000, 850, 700],
                }
            )
        )

        expanded = expand(output, {"ensemble": ["ens1", "ens2"]})
        collapsed = collapse(expanded, "level")

        assert contains(collapsed, {"ensemble": ["ens1"], "param": ["t"], "time": [0, 1]})
        assert not contains(collapsed, {"ensemble": ["ens3"], "param": ["t"], "time": [0, 1]})

    @pytest.mark.parametrize(
        "fixture_name,subset_size",
        [
            ("simple_output", 1),
            ("simple_output", 2),
            ("complex_output", 1),
            ("complex_output", 3),
        ],
    )
    def test_contains_with_varying_subset_sizes(self, fixture_name, subset_size, request):
        """Test contains with subsets of varying sizes"""
        output = request.getfixturevalue(fixture_name)
        output_axes = axes(output)

        if len(output_axes) >= subset_size:
            subset_dims = list(output_axes.keys())[:subset_size]
            subset = {dim: [list(output_axes[dim])[0]] for dim in subset_dims}
            assert contains(output, subset)


class TestQubedOutputAxes:
    """Tests for axes(the) method"""

    @pytest.mark.parametrize(
        "fixture_name,expected_axes",
        [
            ("empty_output", {}),
            ("simple_output", {"param": {"2t", "tp"}, "time": {0, 1, 2}}),
            ("complex_output", {"param": {"t", "q"}, "time": {0, 1, 2}, "level": {1000, 850, 700}}),
        ],
    )
    def test_axes_basic(self, fixture_name, expected_axes, request):
        """Test getting axes from different fixtures"""
        output = request.getfixturevalue(fixture_name)
        output_axes = axes(output)

        assert set(output_axes.keys()) == set(expected_axes.keys())
        for key, expected_values in expected_axes.items():
            assert set(output_axes[key]) == expected_values

    @pytest.mark.parametrize("fixture_name", ["empty_output", "simple_output", "complex_output"])
    def test_axes_after_expand(self, fixture_name, request):
        """Test axes after expansion across fixtures"""
        output = request.getfixturevalue(fixture_name)
        expanded = expand(output, {"ensemble": ["ens1", "ens2"]})
        expanded_axes = axes(expanded)

        assert "ensemble" in expanded_axes
        assert set(expanded_axes["ensemble"]) == {"ens1", "ens2"}
        assert len(expanded_axes) == len(dimensions(output)) + 1

    @pytest.mark.parametrize("fixture_name", ["simple_output", "complex_output"])
    def test_axes_after_collapse(self, fixture_name, request):
        """Test axes after collapse across fixtures"""
        output = request.getfixturevalue(fixture_name)
        dimension_to_collapse = list(dimensions(output))[0]
        collapsed = collapse(output, dimension_to_collapse)
        collapsed_axes = axes(collapsed)

        assert dimension_to_collapse not in collapsed_axes
        assert len(collapsed_axes) == len(dimensions(output)) - 1


class TestQubedOutputDimensions:
    """Tests for dimensions() method"""

    @pytest.mark.parametrize(
        "fixture_name,expand_dim,collapse_dim,expected_dims",
        [
            ("simple_output", {"level": [1000]}, "time", {"param", "level"}),
            ("simple_output", {"ensemble": ["ens1"]}, "param", {"time", "ensemble"}),
            ("complex_output", {"ensemble": ["ens1"]}, "level", {"param", "time", "ensemble"}),
        ],
    )
    def test_dimensions_after_operations(self, fixture_name, expand_dim, collapse_dim, expected_dims, request):
        """Test dimensions after expand and collapse operations"""
        output = request.getfixturevalue(fixture_name)
        expanded = expand(output, expand_dim)
        collapsed = collapse(expanded, collapse_dim)

        assert dimensions(collapsed) == expected_dims


class TestQubedOutputMetadata:
    """Tests for metadata operations"""

    @pytest.mark.parametrize(
        "fixture_name,datatype",
        [
            ("empty_output", "netcdf"),
            ("simple_output", "grib"),
            ("complex_output", "plot"),
        ],
    )
    def test_update_metadata_single_field(self, fixture_name, datatype, request):
        """Test updating a single metadata field across fixtures"""
        output = request.getfixturevalue(fixture_name)
        updated = output.model_copy(update={"datatype": datatype})

        assert updated.datatype == datatype
        assert dimensions(updated) == dimensions(output)

    @pytest.mark.parametrize("fixture_name", ["empty_output", "simple_output", "complex_output"])
    def test_update_metadata_preserves_original(self, fixture_name, request):
        """Test that update preserves original metadata across fixtures"""
        output = request.getfixturevalue(fixture_name)
        original_datatype = output.datatype
        updated = output.model_copy(update={"datatype": "grib"})

        assert output.datatype == original_datatype
        assert updated.datatype == "grib"

    @pytest.mark.parametrize(
        "fixture_name,expand_dim,datatype",
        [
            ("simple_output", {"level": [1000]}, "grib"),
            ("complex_output", {"ensemble": ["ens1"]}, "netcdf"),
        ],
    )
    def test_update_metadata_after_expand(self, fixture_name, expand_dim, datatype, request):
        """Test updating metadata after expansion"""
        output = request.getfixturevalue(fixture_name)
        expanded = expand(output, expand_dim)
        updated = expanded.model_copy(update={"datatype": datatype})

        assert updated.datatype == datatype
        expected_dims = dimensions(output) | set(expand_dim.keys())
        assert dimensions(updated) == expected_dims

    @pytest.mark.parametrize("fixture_name", ["empty_output", "simple_output", "complex_output"])
    def test_multiple_updates_chain(self, fixture_name, request):
        """Test chaining multiple update operations across fixtures"""
        output = request.getfixturevalue(fixture_name)
        result = output
        for dt in ["netcdf", "grib", "plot"]:
            result = output.model_copy(update={"datatype": dt})

        assert result.datatype == "plot"
        assert output.datatype == ""


class TestQubedOutputIntegration:
    """Integration tests combining multiple operations"""

    def test_full_workflow_from_empty(self, empty_output):
        """Test complete workflow from empty to complex operations"""
        # Start with empty
        assert dimensions(empty_output) == set()

        # Add dimensions one by one
        output = expand(empty_output, {"param": ["t", "q"]})
        output = expand(output, {"time": [0, 1, 2]})
        output = expand(output, {"level": [1000, 850]})
        assert dimensions(output) == {"param", "time", "level"}

        # Check containment and update metadata
        assert contains(output, {"param": ["t"], "time": [0]})
        output = output.model_copy(update={"datatype": "netcdf"})
        assert output.datatype == "netcdf"

        # Collapse dimensions
        output = collapse(output, "level")
        assert dimensions(output) == {"param", "time"}

        # Final collapse to empty
        output = collapse(output, ["param", "time"])
        assert dimensions(output) == set()

    def test_complex_expand_collapse_sequence(self, simple_output):
        """Test complex sequence of expand and collapse operations"""
        output = simple_output
        output = expand(output, {"level": [1000, 850, 700]})
        output = expand(output, {"ensemble": ["ens1", "ens2", "ens3"]})
        assert len(dimensions(output)) == 4

        output = collapse(output, "time")
        assert len(dimensions(output)) == 3

        output = expand(output, {"step": [0, 6, 12]})
        assert len(dimensions(output)) == 4

        output = collapse(output, ["level", "step"])
        assert dimensions(output) == {"param", "ensemble"}

    @pytest.mark.parametrize("fixture_name", ["empty_output", "simple_output", "complex_output"])
    def test_immutability_with_chained_operations(self, fixture_name, request):
        """Test immutability with complex operation chains across fixtures"""
        output = request.getfixturevalue(fixture_name)
        original_dims = dimensions(output)
        original_axes = axes(output)
        original_datatype = output.datatype

        # Perform chained operations
        result = expand(output, {"new_dim": [1, 2]})
        result = result.model_copy(update={"datatype": "netcdf"})
        if len(dimensions(result)) > 0:
            first_dim = list(dimensions(result))[0]
            result = collapse(result, first_dim)

        # Original should be unchanged
        assert dimensions(output) == original_dims
        assert axes(output) == original_axes
        assert output.datatype == original_datatype

    @pytest.mark.parametrize(
        "fixture_name,operations",
        [
            ("empty_output", [("expand", {"a": [1, 2]})]),
            ("simple_output", [("expand", {"a": [1, 2]}), ("collapse", "a")]),
            ("simple_output", [("expand", {"a": [1]}), ("expand", {"b": [2]}), ("collapse", ["a", "b"])]),
            ("simple_output", [("expand", {"a": [1]}), ("update", {"datatype": "grib"}), ("collapse", "a")]),
            ("complex_output", [("collapse", "level"), ("expand", {"ensemble": [1, 2]}), ("update", {"datatype": "netcdf"})]),
            ("complex_output", [("collapse", ["time", "level"]), ("expand", {"step": [0, 6, 12]})]),
        ],
    )
    def test_operation_sequences(self, fixture_name, operations, request):
        """Test various sequences of operations across fixtures"""
        output = request.getfixturevalue(fixture_name)

        for op_type, op_arg in operations:
            if op_type == "expand":
                output = expand(output, op_arg)
            elif op_type == "collapse":
                output = collapse(output, op_arg)
            elif op_type == "update":
                output = output.model_copy(update=op_arg)

        assert isinstance(output, QubedOutput)

    @pytest.mark.parametrize(
        "fixture_name,value_types",
        [
            ("empty_output", [1, 2, 3]),  # integers
            ("simple_output", ["a", "b", "c"]),  # strings
            ("complex_output", [1.5, 2.5, 3.5]),  # floats
        ],
    )
    def test_expand_with_different_value_types(self, fixture_name, value_types, request):
        """Test expanding with different value types across fixtures"""
        output = request.getfixturevalue(fixture_name)
        expanded = expand(output, {"new_dimension": value_types})

        assert contains(expanded, "new_dimension")
        assert set(axes(expanded)["new_dimension"]) == set(value_types)

    @pytest.mark.parametrize("fixture_name", ["simple_output", "complex_output"])
    def test_roundtrip_all_dimensions(self, fixture_name, request):
        """Test collapsing all dimensions then restoring them"""
        output = request.getfixturevalue(fixture_name)
        original_dims = list(dimensions(output))
        original_axes = axes(output)

        collapsed = collapse(output, original_dims)
        assert dimensions(collapsed) == set()

        # TODO probably change the expand signature to Mapping or some other covariance issue
        original_axes = typing.cast(dict[str, typing.Iterable], original_axes)
        restored = expand(collapsed, original_axes)
        assert dimensions(restored) == dimensions(output)

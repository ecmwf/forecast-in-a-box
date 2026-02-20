"""
Tests for BlockInstanceOutput

BlockInstanceOutput represents the output produced by a BlockInstance, consisting of dataqube and metadata.
"""

import pytest
from qubed import Qube

from fiab_core.fable import BlockInstanceOutput


@pytest.fixture
def empty_output():
    """Create an empty BlockInstanceOutput"""
    return BlockInstanceOutput()


@pytest.fixture
def simple_output():
    """Create a simple BlockInstanceOutput with param and time dimensions"""
    return BlockInstanceOutput(
        dataqube=Qube.from_datacube(
            {
                "param": ["2t", "tp"],
                "time": [0, 1, 2],
            }
        )
    )


@pytest.fixture
def complex_output():
    """Create a complex BlockInstanceOutput with param, time, and level dimensions"""
    return BlockInstanceOutput(
        dataqube=Qube.from_datacube(
            {
                "param": ["t", "q"],
                "time": [0, 1, 2],
                "level": [1000, 850, 700],
            }
        )
    )


class TestBlockInstanceOutputCreation:
    """Tests for creating BlockInstanceOutput instances"""

    @pytest.mark.parametrize(
        "fixture_name,expected_dimensions",
        [
            ("empty_output", set()),
            ("simple_output", {"param", "time"}),
            ("complex_output", {"param", "time", "level"}),
        ],
    )
    def test_creation_with_dimensions(self, fixture_name, expected_dimensions, request):
        """Test creating BlockInstanceOutput with various dimensions"""
        output = request.getfixturevalue(fixture_name)
        assert output.dimensions() == expected_dimensions
        assert output.metadata.datatype == ""


class TestBlockInstanceOutputExpand:
    """Tests for the expand() method"""

    def test_expand_from_empty(self, empty_output):
        """Test expanding from an empty output"""
        expanded = empty_output.expand({"param": ["t", "q"]})
        assert expanded.dimensions() == {"param"}
        assert set(expanded.axes()["param"]) == {"t", "q"}

    def test_expand_multiple_dimensions(self, simple_output):
        """Test expanding with multiple dimensions at once"""
        expanded = simple_output.expand(
            {
                "ensemble": ["ens1", "ens2"],
                "level": [1000, 850],
            }
        )
        assert expanded.dimensions() == {"param", "time", "ensemble", "level"}
        assert set(expanded.axes()["ensemble"]) == {"ens1", "ens2"}
        assert set(expanded.axes()["level"]) == {1000, 850}

    @pytest.mark.parametrize("fixture_name", ["empty_output", "simple_output", "complex_output"])
    def test_expand_preserves_original(self, fixture_name, request):
        """Test that expand preserves the original output across all fixture types"""
        output = request.getfixturevalue(fixture_name)
        original_dims = output.dimensions()
        original_axes = output.axes()

        expanded = output.expand({"ensemble": ["ens1", "ens2"]})

        assert output.dimensions() == original_dims
        assert output.axes() == original_axes
        assert "ensemble" not in output
        assert "ensemble" in expanded

    def test_expand_chain(self, empty_output):
        """Test chaining multiple expand operations"""
        output = empty_output.expand({"param": ["t"]})
        output = output.expand({"time": [0, 1]})
        output = output.expand({"level": [1000]})

        assert output.dimensions() == {"param", "time", "level"}

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
        expanded = output.expand({"new_dim": dimension_values})
        assert "new_dim" in expanded
        assert set(expanded.axes()["new_dim"]) == set(dimension_values)

    @pytest.mark.parametrize("fixture_name", ["empty_output", "simple_output", "complex_output"])
    def test_expand_with_empty_dict(self, fixture_name, request):
        """Test expanding with an empty dictionary preserves state"""
        output = request.getfixturevalue(fixture_name)
        original_dims = output.dimensions()
        expanded = output.expand({})
        assert expanded.dimensions() == original_dims

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
        expanded = output.expand({dimension_name: ["new1", "new2"]})
        assert dimension_name in expanded
        assert expanded.dimensions() >= output.dimensions()


class TestBlockInstanceOutputCollapse:
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
        collapsed = output.collapse(dimensions_to_collapse)
        assert collapsed.dimensions() == expected_dims

    @pytest.mark.parametrize("fixture_name", ["simple_output", "complex_output"])
    def test_collapse_preserves_original(self, fixture_name, request):
        """Test that collapse preserves the original output across fixtures"""
        output = request.getfixturevalue(fixture_name)
        original_dims = output.dimensions()
        original_axes = output.axes()

        first_dim = list(output.dimensions())[0]
        collapsed = output.collapse(first_dim)

        assert output.dimensions() == original_dims
        assert output.axes() == original_axes
        assert first_dim in output
        assert first_dim not in collapsed

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
            output.collapse(invalid_dimension)

    def test_collapse_chain(self, complex_output):
        """Test chaining multiple collapse operations"""
        output = complex_output.collapse("level").collapse("time")
        assert output.dimensions() == {"param"}

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
        expanded = output.expand(expand_dimension)
        collapsed = expanded.collapse(collapse_dimension)

        assert collapsed.dimensions() == output.dimensions()
        assert collapsed.axes() == output.axes()

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
        collapsed = output.collapse(collapse_dimension)
        expanded = collapsed.expand(expand_dimension)
        assert expanded.dimensions() == output.dimensions()

    @pytest.mark.parametrize("fixture_name", ["simple_output", "complex_output"])
    def test_collapse_same_dimension_twice(self, fixture_name, request):
        """Test that collapsing the same dimension twice raises error"""
        output = request.getfixturevalue(fixture_name)
        first_dim = list(output.dimensions())[0]
        collapsed = output.collapse(first_dim)

        with pytest.raises(ValueError):
            collapsed.collapse(first_dim)


class TestBlockInstanceOutputContains:
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
        assert (dimension in output) == expected

    @pytest.mark.parametrize("fixture_name", ["empty_output", "simple_output", "complex_output"])
    def test_contains_empty_dict(self, fixture_name, request):
        """Test that empty dict is always contained"""
        output = request.getfixturevalue(fixture_name)
        assert {} in output

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
        assert (subset in simple_output) == expected

    def test_contains_subset_after_expand_collapse(self):
        """Test checking if a subset exists after expand and collapse"""
        output = BlockInstanceOutput(
            dataqube=Qube.from_datacube(
                {
                    "param": ["t", "q"],
                    "time": [0, 1, 2],
                    "level": [1000, 850, 700],
                }
            )
        )

        expanded = output.expand({"ensemble": ["ens1", "ens2"]})
        collapsed = expanded.collapse("level")

        assert {"ensemble": ["ens1"], "param": ["t"], "time": [0, 1]} in collapsed
        assert {"ensemble": ["ens3"], "param": ["t"], "time": [0, 1]} not in collapsed

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
        axes = output.axes()

        if len(axes) >= subset_size:
            subset_dims = list(axes.keys())[:subset_size]
            subset = {dim: [list(axes[dim])[0]] for dim in subset_dims}
            assert subset in output


class TestBlockInstanceOutputAxes:
    """Tests for the axes() method"""

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
        axes = output.axes()

        assert set(axes.keys()) == set(expected_axes.keys())
        for key, expected_values in expected_axes.items():
            assert set(axes[key]) == expected_values

    @pytest.mark.parametrize("fixture_name", ["empty_output", "simple_output", "complex_output"])
    def test_axes_after_expand(self, fixture_name, request):
        """Test axes after expansion across fixtures"""
        output = request.getfixturevalue(fixture_name)
        expanded = output.expand({"ensemble": ["ens1", "ens2"]})
        axes = expanded.axes()

        assert "ensemble" in axes
        assert set(axes["ensemble"]) == {"ens1", "ens2"}
        assert len(axes) == len(output.dimensions()) + 1

    @pytest.mark.parametrize("fixture_name", ["simple_output", "complex_output"])
    def test_axes_after_collapse(self, fixture_name, request):
        """Test axes after collapse across fixtures"""
        output = request.getfixturevalue(fixture_name)
        dimension_to_collapse = list(output.dimensions())[0]
        collapsed = output.collapse(dimension_to_collapse)
        axes = collapsed.axes()

        assert dimension_to_collapse not in axes
        assert len(axes) == len(output.dimensions()) - 1


class TestBlockInstanceOutputDimensions:
    """Tests for the dimensions() method"""

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
        expanded = output.expand(expand_dim)
        collapsed = expanded.collapse(collapse_dim)

        assert collapsed.dimensions() == expected_dims


class TestBlockInstanceOutputMetadata:
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
        updated = output.update(datatype=datatype)

        assert updated.metadata.datatype == datatype
        assert updated.dimensions() == output.dimensions()

    @pytest.mark.parametrize("fixture_name", ["empty_output", "simple_output", "complex_output"])
    def test_update_metadata_preserves_original(self, fixture_name, request):
        """Test that update preserves original metadata across fixtures"""
        output = request.getfixturevalue(fixture_name)
        original_datatype = output.metadata.datatype
        updated = output.update(datatype="grib")

        assert output.metadata.datatype == original_datatype
        assert updated.metadata.datatype == "grib"

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
        expanded = output.expand(expand_dim)
        updated = expanded.update(datatype=datatype)

        assert updated.metadata.datatype == datatype
        expected_dims = output.dimensions() | set(expand_dim.keys())
        assert updated.dimensions() == expected_dims

    @pytest.mark.parametrize("fixture_name", ["empty_output", "simple_output", "complex_output"])
    def test_multiple_updates_chain(self, fixture_name, request):
        """Test chaining multiple update operations across fixtures"""
        output = request.getfixturevalue(fixture_name)
        result = output.update(datatype="netcdf").update(datatype="grib").update(datatype="plot")

        assert result.metadata.datatype == "plot"
        assert output.metadata.datatype == ""


class TestBlockInstanceOutputIntegration:
    """Integration tests combining multiple operations"""

    def test_full_workflow_from_empty(self, empty_output):
        """Test complete workflow from empty to complex operations"""
        # Start with empty
        assert empty_output.dimensions() == set()

        # Add dimensions one by one
        output = empty_output.expand({"param": ["t", "q"]})
        output = output.expand({"time": [0, 1, 2]})
        output = output.expand({"level": [1000, 850]})
        assert output.dimensions() == {"param", "time", "level"}

        # Check containment and update metadata
        assert {"param": ["t"], "time": [0]} in output
        output = output.update(datatype="netcdf")
        assert output.metadata.datatype == "netcdf"

        # Collapse dimensions
        output = output.collapse("level")
        assert output.dimensions() == {"param", "time"}

        # Final collapse to empty
        output = output.collapse(["param", "time"])
        assert output.dimensions() == set()

    def test_complex_expand_collapse_sequence(self, simple_output):
        """Test complex sequence of expand and collapse operations"""
        output = simple_output
        output = output.expand({"level": [1000, 850, 700]})
        output = output.expand({"ensemble": ["ens1", "ens2", "ens3"]})
        assert len(output.dimensions()) == 4

        output = output.collapse("time")
        assert len(output.dimensions()) == 3

        output = output.expand({"step": [0, 6, 12]})
        assert len(output.dimensions()) == 4

        output = output.collapse(["level", "step"])
        assert output.dimensions() == {"param", "ensemble"}

    @pytest.mark.parametrize("fixture_name", ["empty_output", "simple_output", "complex_output"])
    def test_immutability_with_chained_operations(self, fixture_name, request):
        """Test immutability with complex operation chains across fixtures"""
        output = request.getfixturevalue(fixture_name)
        original_dims = output.dimensions()
        original_axes = output.axes()
        original_datatype = output.metadata.datatype

        # Perform chained operations
        result = output.expand({"new_dim": [1, 2]}).update(datatype="netcdf")
        if len(result.dimensions()) > 0:
            first_dim = list(result.dimensions())[0]
            result = result.collapse(first_dim)

        # Original should be unchanged
        assert output.dimensions() == original_dims
        assert output.axes() == original_axes
        assert output.metadata.datatype == original_datatype

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
                output = output.expand(op_arg)
            elif op_type == "collapse":
                output = output.collapse(op_arg)
            elif op_type == "update":
                output = output.update(**op_arg)

        assert isinstance(output, BlockInstanceOutput)

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
        expanded = output.expand({"new_dimension": value_types})

        assert "new_dimension" in expanded
        assert set(expanded.axes()["new_dimension"]) == set(value_types)

    @pytest.mark.parametrize("fixture_name", ["simple_output", "complex_output"])
    def test_roundtrip_all_dimensions(self, fixture_name, request):
        """Test collapsing all dimensions then restoring them"""
        output = request.getfixturevalue(fixture_name)
        original_dims = list(output.dimensions())
        original_axes = output.axes()

        collapsed = output.collapse(original_dims)
        assert collapsed.dimensions() == set()

        restored = collapsed.expand(original_axes)
        assert restored.dimensions() == output.dimensions()

# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


from qubed import Qube

from forecastbox.products.product import GenericParamProduct


class TestProduct(GenericParamProduct):
    def execute(self, product_spec, model, source):
        raise NotImplementedError("Testing")

    @property
    def qube(self) -> Qube:
        raise NotImplementedError("Testing")


def test_make_generic_qube():
    """Test the `make_generic_qube` method."""
    product = TestProduct()
    qube = product.make_generic_qube(options=["value1", "value2"])

    assert isinstance(qube, Qube)
    assert qube.span("options") == ["value1", "value2"]

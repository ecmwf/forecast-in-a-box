from forecastbox.products.registry import CategoryRegistry

from earthkit.workflows.fluent import Payload
from forecastbox.products.product import GenericParamProduct

from forecastbox.models import Model

simple_registry = CategoryRegistry("Simple", "Simple products", "Simple")


EARTHKIT_PLOTS_IMPORTED = True
try:
    import earthkit.plots
except ImportError:
    EARTHKIT_PLOTS_IMPORTED = False


@simple_registry("Maps")
class MapProduct(GenericParamProduct):
    @property
    def qube(self):
        return self.make_generic_qube()

    def mars_request(self, **kwargs):
        return super().mars_request(**kwargs)  # type:ignore

    def to_graph(self, specification, source):
        source = self.select_on_specification(specification, source)

        from earthkit.plots import quickplot

        plots = source.map(
            Payload(
                quickplot,
            ),
        )
        return plots

    def validate_intersection(self, model: Model) -> bool:
        return EARTHKIT_PLOTS_IMPORTED


@simple_registry("Record")
class RecordProduct(GenericParamProduct):
    @property
    def qube(self):
        return self.make_generic_qube()

    def mars_request(self, **kwargs):
        return super().mars_request(**kwargs)  # type:ignore

    def to_graph(self, specification, source):
        source = self.select_on_specification(specification, source)
        return source

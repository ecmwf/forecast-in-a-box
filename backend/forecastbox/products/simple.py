from forecastbox.products.registry import CategoryRegistry

from earthkit.workflows.fluent import Payload
from forecastbox.products.product import GenericTemporalProduct, GenericParamProduct

from forecastbox.models import Model

import earthkit.data as ekd
from anemoi.cascade.fluent import ENSEMBLE_DIMENSION_NAME

simple_registry = CategoryRegistry("Simple", "Simple products", "Simple")


EARTHKIT_PLOTS_IMPORTED = True
try:
    import earthkit.plots as ekp
except ImportError:
    EARTHKIT_PLOTS_IMPORTED = False

def quickplot(field: ekd.Field, domain=None):
    chart = ekp.Map(domain=domain)

    chart.quickplot(field)

    chart.title("{variable_name} over {domain}\n"
        "Base time: {base_time:%H:%M on %-d %B %Y}\n"
        "Valid time: {valid_time:%H:%M on %-d %B %Y} (T+{lead_time})"
    )

    chart.legend(label="{variable_name} ({units})")

    chart.coastlines()
    chart.gridlines()

    return chart.figure

@simple_registry("Maps")
class MapProduct(GenericTemporalProduct):
    domains = ['Global', 'Europe', 'Australia', 'Malawi']

    description = {
        **GenericTemporalProduct.description,
        'domain': "Domain of the map",
    }
    label = {
        **GenericTemporalProduct.label,
        'domain': "Domain",
    }
    multiselect = {
        "param": True,
    }

    @property
    def model_assumptions(self):
        return {
            'domain': self.domains,
        }
    
    @property
    def qube(self):
        return self.make_generic_qube(domain = self.domains)

    def mars_request(self, **kwargs):
        return super().mars_request(**kwargs)  # type:ignore

    def to_graph(self, specification, source):
        domain = specification.pop('domain', None)
        source = self.select_on_specification(specification, source)

        if ENSEMBLE_DIMENSION_NAME in source.nodes.dims:
            source = source.stack(ENSEMBLE_DIMENSION_NAME)

        plots = source.map(
            Payload(
                quickplot,
                kwargs={'domain': domain},
            ),
        )
        return plots

    def validate_intersection(self, model: Model) -> bool:
        return EARTHKIT_PLOTS_IMPORTED

# @simple_registry('Gif')
# class GifProduct(GenericParamProduct):
#     pass

@simple_registry("Grib")
class GribProduct(GenericTemporalProduct):

    multiselect = {
        "param": True,
        "step": True,
    }

    @property
    def qube(self):
        return self.make_generic_qube()

    def mars_request(self, **kwargs):
        return super().mars_request(**kwargs)  # type:ignore

    def to_graph(self, specification, source):
        source = self.select_on_specification(specification, source)
        return source

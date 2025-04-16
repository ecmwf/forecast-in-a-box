
from typing import Any
import warnings

from forecastbox.products.registry import CategoryRegistry

from earthkit.workflows.fluent import Payload, Action
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

def quickplot(fields: ekd.FieldList, domain=None):
    from earthkit.plots.utils import iter_utils
    from earthkit.plots.components import layouts
    from earthkit.plots.schemas import schema

    if not isinstance(fields, ekd.FieldList):
        fields = ekd.FieldList.from_fields(fields)

    print(fields.ls())

    groupby = 'valid_datetime'

    unique_values = iter_utils.flatten(arg.metadata(groupby) for arg in fields)
    unique_values = list(dict.fromkeys(unique_values))

    grouped_data = {val: fields.sel(**{groupby: val}) for val in unique_values}
    n_plots = len(grouped_data)

    rows, columns = layouts.rows_cols(n_plots)
    
    figure = ekp.Figure(rows=rows, columns=columns)

    for i, (group_val, group_args) in enumerate(grouped_data.items()):
        subplot = figure.add_map(domain=domain)
        for f in group_args:
            subplot.quickplot(f, units = None)
        
        for m in schema.quickmap_subplot_workflow:
            args = []
            if m == "title":
                args = ["Valid time: {valid_time:%H:%M on %-d %B %Y} (T+{lead_time})"]
            try:
                getattr(subplot, m)(*args)
            except Exception as err:
                warnings.warn(
                    f"Failed to execute {m} on given data with: \n"
                    f"{err}\n\n"
                    "consider constructing the plot manually."
                )

    for m in schema.quickmap_figure_workflow:
        try:
            getattr(figure, m)()
        except Exception as err:
            warnings.warn(
                f"Failed to execute {m} on given data with: \n"
                f"{err}\n\n"
                "consider constructing the plot manually."
            )

    figure.title("{variable_name} over {domain}\n"
        # "Base time: {base_time:%H:%M on %-d %B %Y}\n"
        # "Valid time: {valid_time:%H:%M on %-d %B %Y} (T+{lead_time})"
    )

    return figure

@simple_registry("Maps")
class MapProduct(GenericTemporalProduct):
    """
    Map Product.

    This product is a simple wrapper around the `earthkit.plots` library to create maps.

    # TODO, Add projection, and title control
    """
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
        "step": True,
        "domain": False,
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

    def to_graph(self, specification: dict[str, Any], source: Action):
        domain = specification.pop('domain', None)
        source = self.select_on_specification(specification, source)

        if ENSEMBLE_DIMENSION_NAME in source.nodes.dims:
            source = source.stack(ENSEMBLE_DIMENSION_NAME)
        
        if domain == 'Global':
            domain = None
        
        source = source.concatenate('param')
        source = source.concatenate('step')

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

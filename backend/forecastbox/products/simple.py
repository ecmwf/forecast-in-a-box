import warnings

from forecastbox.products.registry import CategoryRegistry
from forecastbox.products.ensemble import ensemble_registry, BaseEnsembleProduct

from earthkit.workflows import mark
from earthkit.workflows.decorators import as_payload
from forecastbox.products.product import GenericTemporalProduct

from forecastbox.models import Model

import earthkit.data as ekd
from earthkit.workflows.plugins.anemoi.fluent import ENSEMBLE_DIMENSION_NAME

simple_registry = CategoryRegistry("Simple", "Simple products", "Simple")


EARTHKIT_PLOTS_IMPORTED = True
try:
    import earthkit.plots as ekp
except ImportError:
    EARTHKIT_PLOTS_IMPORTED = False


@as_payload
@mark.environment_requirements(["earthkit-plots", "earthkit-plots-default-styles"])
def quickplot(fields: ekd.FieldList, groupby: str = None, subplot_title: str = None, figure_title: str = None, domain=None):
    from earthkit.plots.utils import iter_utils
    from earthkit.plots.components import layouts
    from earthkit.plots.schemas import schema

    if not isinstance(fields, ekd.FieldList):
        fields = ekd.FieldList.from_fields(fields)

    print(fields.ls())

    if groupby:
        unique_values = iter_utils.flatten(arg.metadata(groupby) for arg in fields)
        unique_values = list(dict.fromkeys(unique_values))

        grouped_data = {val: fields.sel(**{groupby: val}) for val in unique_values}
    else:
        grouped_data = {None: fields}

    n_plots = len(grouped_data)

    rows, columns = layouts.rows_cols(n_plots)

    figure = ekp.Figure(rows=rows, columns=columns)

    if subplot_title is None:
        subplot_title = f"{{{groupby}}}"

    for i, (group_val, group_args) in enumerate(grouped_data.items()):
        print(f"Plotting {group_val} ({i+1}/{n_plots})")
        subplot = figure.add_map(domain=domain)
        for f in group_args:
            print(f, f.metadata().dump())
            subplot.quickplot(f, units=None)

        for m in schema.quickmap_subplot_workflow:
            args = []
            if m == "title":
                args = [subplot_title]
            try:
                getattr(subplot, m)(*args)
            except Exception as err:
                warnings.warn(f"Failed to execute {m} on given data with: \n" f"{err}\n\n" "consider constructing the plot manually.")
        print(f"Plotted {group_val} ({i+1}/{n_plots})")

    for m in schema.quickmap_figure_workflow:
        try:
            getattr(figure, m)()
        except Exception as err:
            warnings.warn(f"Failed to execute {m} on given data with: \n" f"{err}\n\n" "consider constructing the plot manually.")

    figure.title(figure_title)

    return figure


class MapProduct(GenericTemporalProduct):
    """
    Map Product.

    This product is a simple wrapper around the `earthkit.plots` library to create maps.

    # TODO, Add projection, and title control
    """

    domains = ["Global", "Europe", "Australia", "Malawi"]

    description = {
        **GenericTemporalProduct.description,
        "domain": "Domain of the map",
    }
    label = {
        **GenericTemporalProduct.label,
        "domain": "Domain",
    }

    @property
    def model_assumptions(self):
        return {
            "domain": self.domains,
        }

    @property
    def qube(self):
        return self.make_generic_qube(domain=self.domains)

    def validate_intersection(self, model: Model) -> bool:
        return super().validate_intersection(model) and EARTHKIT_PLOTS_IMPORTED


@simple_registry("Maps")
class SimpleMapProduct(MapProduct):
    multiselect = {
        "param": True,
        "step": True,
        "domain": False,
    }

    defaults = {
        "domain": "Global",
    }

    def to_graph(self, product_spec, model, source):
        domain = product_spec.pop("domain", None)
        source = self.select_on_specification(product_spec, source)

        if domain == "Global":
            domain = None

        source = source.concatenate("param")
        source = source.concatenate("step")

        quickplot_payload = quickplot(
            domain=domain,
            groupby="valid_datetime",
            subplot_title="T+{lead_time}",
            figure_title="{variable_name} over {domain}\n Base time: {base_time:%H%M %d/%m/%Y}\n",
        )
        plots = source.map(quickplot_payload)

        return plots


@ensemble_registry("Maps")
class EnsembleMapProduct(BaseEnsembleProduct, MapProduct):
    """
    Ensemble Map Product.

    Create a subplotted map with each subplot being a different ensemble member.
    """

    multiselect = {
        "param": True,
        "step": False,
        "domain": False,
    }
    defaults = {
        "domain": "Global",
    }

    def to_graph(self, product_spec, model, source):
        domain = product_spec.pop("domain", None)
        source = self.select_on_specification(product_spec, source)

        if domain == "Global":
            domain = None

        source = source.concatenate(ENSEMBLE_DIMENSION_NAME)
        source = source.concatenate("param")

        quickplot_payload = quickplot(
            domain=domain,
            groupby="member",
            subplot_title="n{member}",
            figure_title="{variable_name} over {domain}\nValid time: {valid_time:%H:%M on %-d %B %Y} (T+{lead_time})\n",
        )
        plots = source.map(quickplot_payload)
        return plots


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

    def to_graph(self, product_spec, model, source):
        source = self.select_on_specification(product_spec, source).concatenate("param").concatenate("step")
        return source.map(self.named_payload("grib"))


@simple_registry("Deaccumulated")
class DeaccumulatedProduct(GenericTemporalProduct):
    """
    Deaccumulated Product.
    """

    multiselect = {
        "param": True,
        "step": True,
    }

    @property
    def qube(self):
        return self.make_generic_qube()

    def to_graph(self, product_spec, model, source):
        return self.select_on_specification(product_spec, model.deaccumulate(source)).map(self.named_payload("deaccumulated"))

from.registry import CategoryRegistry

from.product import GenericParamProduct

from cascade.fluent import Payload

plot_registry=CategoryRegistry("Plots","Plot the model output","Plots")



@plot_registry("Map")
class MapProduct(GenericParamProduct):
    @property
    def qube(self):
        return self.make_generic_qube()

    def mars_request(self, **kwargs):
        return super().mars_request(**kwargs)#type:ignore

    def to_graph(self, specification, source):
        source = self.select_on_specification(specification, source)

        from earthkit.plots import quickplot
        plots = source.map(
            Payload(
                quickplot,
            ),
        )
        return plots

from cascade import backends, fluent

def _quantiles_transform(action, quantile: float, new_dim: str, metadata: dict | None):
    payload = fluent.Payload(
        backends.quantiles,
        (fluent.Node.input_name(0), quantile),
        {"metadata": metadata},
    )
    new_quantile = action.map(payload)
    new_quantile._add_dimension(new_dim, quantile)
    return new_quantile
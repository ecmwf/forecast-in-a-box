from earthkit.workflows import fluent, backends

def quantiles_transform(action: fluent.Action, quantile: float, new_dim: str, metadata: dict | None):
    payload = fluent.Payload(
        backends.quantiles,
        (quantile, ),
        {"metadata": metadata},
    )
    new_quantile = action.map(payload)
    new_quantile._add_dimension(new_dim, quantile)
    return new_quantile


__all__ = [
    "quantiles_transform",
]
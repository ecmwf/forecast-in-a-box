from ..registry import CategoryRegistry

ensemble_registry = CategoryRegistry("ensemble", "Capture the distribution of the ensemble", "Ensemble")

from .base import BaseEnsembleProduct
from . import threshold, quantiles, ens_stats

__all__ = [
    'ensemble_registry',
]
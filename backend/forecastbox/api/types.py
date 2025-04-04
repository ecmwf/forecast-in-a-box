"""API"""

from typing import Optional, Any
from dataclasses import dataclass, field

from forecastbox.products.product import USER_DEFINED

CONFIG_ORDER = ["param", "levtype", "levelist"]

ModelName = str


@dataclass
class ModelSpecification:
    """Model Configuration"""

    model: ModelName
    """Model name"""
    date: str
    """Date"""
    lead_time: int
    """Lead time"""
    ensemble_members: int
    """Number of ensemble members"""
    entries: dict[str, str] = field(default_factory=dict)
    """Configuration entries"""

    def __post_init__(self):
        self.model = self.model.lower().replace("_", "/")


EnvironmentSpecification = dict[str, str]


@dataclass
class ConfigEntry:
    """Configuration Entry"""

    label: str
    """Label of the configuration entry"""
    description: str | None
    """Description of the configuration entry"""
    values: Optional[list[str]] = None
    """Available values for the configuration entry"""
    example: Optional[str] = None
    """Example value for the configuration entry"""
    multiple: bool = False
    """Whether the configuration entry is a multiple select"""
    constrained_by: list[str] = field(default_factory=list)
    """List of configuration entries that this entry is constrained by"""  # TODO

    def __post_init__(self):
        if USER_DEFINED in self.values:
            self.values = None

        if self.values is None:
            self.select = False
            self.multiple = False
        else:
            self._sort_values()

    def _sort_values(self):
        """Sort values."""
        if all(str(x).isdigit() for x in self.values):
            self.values = list(map(str, sorted(self.values, key=float)))
            return
        self.values = list(map(str, sorted(self.values, key=lambda x: str(x).lower())))


@dataclass
class ProductConfiguration:
    """Product Configuration"""

    product: str
    """Product name"""
    options: dict[str, ConfigEntry]
    """Configuration spec"""

    def __post_init__(self):
        new_options = {}
        for key in CONFIG_ORDER:
            if key in self.options:
                new_options[key] = self.options[key]

        for key in self.options:
            if key not in new_options:
                new_options[key] = self.options[key]

        self.options = new_options


@dataclass
class ProductSpecification:
    """Product Specification

    A user has chosen a product and specified the configuration.
    """

    product: str
    """Product name"""
    specification: dict[str, Any]
    """Specification"""


@dataclass
class GraphSpecification:
    model: ModelSpecification
    """Model Configuration"""
    products: list[ProductSpecification]
    """Product Configuration"""
    environment: EnvironmentSpecification
    """Environment Configuration"""

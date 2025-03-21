"""Products API Router."""

from fastapi import APIRouter

from typing import Any, Optional
from dataclasses import dataclass

from forecastbox.products.product import Product, USER_DEFINED

from forecastbox.products.registry import get_categories, get_product, Category
from forecastbox.models import Model

from ..models import open_checkpoint


from qubed import Qube

router = APIRouter(
	tags=["products"],
	responses={404: {"description": "Not found"}},
)

CONFIG_ORDER = ["param", "levtype", "levelist"]


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
class ProductConfig:
	"""Product Configuration"""

	product: str
	"""Product name"""
	entries: dict[str, ConfigEntry]
	"""Configuration entries"""

	def __post_init__(self):
		new_entries = {}
		for key in CONFIG_ORDER:
			if key in self.entries:
				new_entries[key] = self.entries[key]

		for key in self.entries:
			if key not in new_entries:
				new_entries[key] = self.entries[key]

		self.entries = new_entries


def select_from_params(available_spec: Qube, params: dict[str, Any]) -> Qube:
	for key, val in params.items():
		if not val:
			continue
		if key in available_spec.axes() and USER_DEFINED in available_spec.axes().get(key, []):
			# Dont select if open ended
			continue
		available_spec = available_spec.select({key: val})
	return available_spec

async def product_to_config(product: Product, selected_model: str, params: dict[str, Any]) -> ProductConfig:
	"""Convert a product to a configuration."""

	from qubed import Qube

	product_spec = product.qube

	ckpt = await open_checkpoint(selected_model)
	model_spec = Model(ckpt)
	model_qube = model_spec.qube(product.model_assumptions)

	selected_spec = Qube.from_datacube({k: v for k, v in params.items() if v})

	available_product_spec = product.model_intersection(model_spec)
	subsetted_spec = select_from_params(model_qube & product_spec, params)

	if len(subsetted_spec.axes()) == 0 and selected_spec:
		subsetted_spec = selected_spec

	axes = subsetted_spec.axes()

	entries = {}
	for key, val in axes.items():
		# Add back in other options when selected
		if key in params and (len(val) == 1 or product.multiselect.get(key, False)):
			val = select_from_params(available_product_spec, {k: v for k, v in params.items() if not k == key}).axes().get(key, val)
		
		entries[key] = ConfigEntry(
			label=product.label.get(key, key),
			description=product.description.get(key, None),
			values=list(val),
			example=product.example.get(key, None),
			multiple=product.multiselect.get(key, False),
		)

	for key in model_spec.ignore_in_select:
		entries.pop(key, None)

	return ProductConfig(product.__class__.__name__, entries)


@router.get("/categories")
async def api_get_categories():
	return get_categories()

@router.get("/valid-categories/{model_name}")
async def get_valid_categories(model_name: str) -> dict[str, Category]:
	ckpt = await open_checkpoint(model_name)
	

	valid_categories = {}
	for category, products in get_categories().items():
		valid_products = []
		for product in products.options:
			prod = get_product(category, product)

			model_spec = Model(ckpt)
			if prod.validate_intersection(prod.model_intersection(model_spec)):
				valid_products.append(product)
				
		if valid_products:
			valid_categories[category] = products
			valid_categories[category].options = valid_products

	return valid_categories

@router.post("/configuration/{category}/{product}")
async def get_product_configuration(category, product: str, params: dict) -> dict[str, ConfigEntry]:
	selected_model = params["model"]
	spec = params["spec"]

	prod = get_product(category, product)

	conf = await product_to_config(prod, selected_model, spec)
	return conf.entries

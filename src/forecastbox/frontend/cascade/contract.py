from forecastbox.api.common import JinjaTemplate
from typing import Callable, Any
from dataclasses import dataclass
from cascade.low.builders import JobBuilder

# TODO better contract on params? But then its tied to Template anyway...


@dataclass
class FormBuilder:
	template: JinjaTemplate
	params: dict[str, Any]


@dataclass
class CascadeJob:
	form_builder: FormBuilder
	job_builder: Callable[[dict[str, str]], JobBuilder]

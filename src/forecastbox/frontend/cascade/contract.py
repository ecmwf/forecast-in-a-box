from forecastbox.api.common import JinjaTemplate
from typing import Callable, Any
from dataclasses import dataclass
from cascade.v2.core import JobInstance

# TODO better contract on params? But then its tied to Template anyway...


@dataclass
class FormBuilder:
	template: JinjaTemplate
	params: dict[str, Any]


JobBuilder = Callable[[dict[str, str]], JobInstance]


@dataclass
class CascadeJob:
	form_builder: FormBuilder
	job_builder: JobBuilder

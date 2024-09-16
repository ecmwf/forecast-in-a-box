from typing import Iterable, Optional
from forecastbox.frontend.cascade.contract import CascadeJob
from forecastbox.frontend.cascade.hello_cascade import HelloCascade

catalog = {"hello_cascade": HelloCascade}


def get_registered_jobs() -> Iterable[str]:
	# TODO extend the original select template with display_name/enum_name, then return here a pair
	return catalog.keys()


def get_cascade(job_name: str) -> Optional[CascadeJob]:
	return catalog.get(job_name, None)

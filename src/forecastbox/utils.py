from typing import NoReturn, Any


def assert_never(v: Any) -> NoReturn:
	"""For exhaustive enumm checks etc"""
	raise TypeError(v)

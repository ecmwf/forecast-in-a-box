from typing import NoReturn, Any, Generic, TypeVar, Optional, Callable, cast
from typing_extensions import Self


def assert_never(v: Any) -> NoReturn:
	"""For exhaustive enumm checks etc"""
	raise TypeError(v)


T = TypeVar("T")
U = TypeVar("U")
E = TypeVar("E")


class Either(Generic[T, E]):
	def __init__(self, t: Optional[T] = None, e: Optional[E] = None):
		self.t = t
		self.e = e

	@classmethod
	def ok(cls, t: T) -> Self:
		return cls(t=t)

	@classmethod
	def error(cls, e: E) -> Self:
		return cls(e=e)

	def get_or_raise(self, raiser: Optional[Callable[[E], BaseException]]) -> T:
		if self.e:
			if not raiser:
				raise ValueError(self.e)
			else:
				raise raiser(self.e)
		else:
			return cast(T, self.t)

	def chain(self, f: Callable[[T], "Either[U, E]"]) -> "Either[U, E]":
		if self.e:
			return self.error(self.e)  # type: ignore # needs higher python and more magic
		else:
			return f(cast(T, self.t))

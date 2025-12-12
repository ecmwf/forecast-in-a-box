from typing import Any, Callable, Iterable, Mapping, cast

from cascade.low.func import assert_never, pyd_replace
from pydantic import BaseModel

# TODO move to ecpyutil


def pydantic_recursive_replace(base: BaseModel | Iterable, replacer: Callable[[BaseModel], dict[str, Any]]) -> BaseModel | Iterable:
    # TODO this may not be batch-efficient for some replacers -- measure and consider batch variant!
    if isinstance(base, BaseModel):
        recursive = {k: pydantic_recursive_replace(v, replacer) for k, v in base if isinstance(v, BaseModel | Iterable)}
        specific = replacer(base)
        return pyd_replace(base, **{**recursive, **specific})
    elif isinstance(base, Mapping):
        # NOTE the cast below is extraneous but `ty` mandates it
        return {
            k: pydantic_recursive_replace(cast(BaseModel | Iterable, v), replacer) if isinstance(v, BaseModel | Iterable) else v
            for k, v in base.items()
        }
    elif isinstance(base, str):
        return base  # NOTE otherwise infinite recursion due to python inner beauty
    elif isinstance(base, Iterable):
        return [pydantic_recursive_replace(v, replacer) if isinstance(v, BaseModel | Iterable) else v for v in base]
    else:
        assert_never(base)

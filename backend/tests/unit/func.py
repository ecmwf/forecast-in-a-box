# TODO move to ecpyutil once published
from typing import Any

from pydantic import BaseModel

from forecastbox.func import pydantic_recursive_replace


def test_pydantic_recursive_replace():
    class M1(BaseModel):
        s: str
        i: int
        o: float

    class M2(BaseModel):
        s: str
        u: int
        m: M1

    def replacer(m: BaseModel) -> dict[str, Any]:
        rv = {}
        if hasattr(m, "s"):
            rv["s"] = m.s * 2  # ty: ignore
        if hasattr(m, "i"):
            rv["i"] = m.i + 1  # ty: ignore
        return rv

    src = M1(s="v", i=41, o=3.14)
    trg = M1(s="vv", i=42, o=3.14)
    assert pydantic_recursive_replace(src, replacer) == trg
    assert pydantic_recursive_replace(M2(s="uu", u=1, m=src), replacer) == M2(s="uuuu", u=1, m=trg)
    assert pydantic_recursive_replace([src], replacer) == [trg]
    assert pydantic_recursive_replace({"s": src}, replacer) == {"s": trg}

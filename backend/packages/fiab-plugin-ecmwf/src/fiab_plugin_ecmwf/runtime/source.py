from typing import Any

import earthkit.data


def earthkit_source(name: str, requests: list[dict], **kwargs: Any) -> earthkit.data.SimpleFieldList:
    if name.startswith("opendata"):
        idx = name.find(":")
        if idx > 0:
            kwargs["source"] = name[idx + 1 :]
        name = "ecmwf-open-data"
    fieldlist = earthkit.data.SimpleFieldList()
    for request in requests:
        fieldlist += earthkit.data.from_source(name, request=request, **kwargs).to_fieldlist()  # type:ignore[unresolved-attribute]
    return fieldlist

from typing import Any

import earthkit.data


def earthkit_source(name: str, requests: list[dict], **kwargs: Any) -> earthkit.data.SimpleFieldList:
    fieldlist = earthkit.data.SimpleFieldList()
    for request in requests:
        fieldlist += earthkit.data.from_source(name, request=request, **kwargs).to_fieldlist()  # type:ignore[unresolved-attribute]
    return fieldlist

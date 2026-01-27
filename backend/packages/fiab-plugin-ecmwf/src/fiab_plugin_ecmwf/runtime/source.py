import earthkit.data


def earthkit_source(source: str, request: dict) -> earthkit.data.SimpleFieldList:
    return earthkit.data.from_source(source, request=request).to_fieldlist()  # type:ignore[unresolved-attribute]

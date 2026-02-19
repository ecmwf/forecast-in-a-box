import earthkit.data


def earthkit_source(source: str, **kwargs) -> earthkit.data.SimpleFieldList:
    return earthkit.data.from_source(source, **kwargs).to_fieldlist()  # type:ignore[unresolved-attribute]

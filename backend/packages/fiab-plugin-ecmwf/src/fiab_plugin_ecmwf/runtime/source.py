import earthkit.data


def earthkit_source(name: str, **kwargs) -> earthkit.data.SimpleFieldList:
    return earthkit.data.from_source(name, **kwargs).to_fieldlist()  # type:ignore[unresolved-attribute]

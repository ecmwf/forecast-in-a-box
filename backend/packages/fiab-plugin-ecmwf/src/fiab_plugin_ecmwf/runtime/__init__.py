import earthkit.data
from earthkit.workflows.backends import register

register(earthkit.data.SimpleFieldList, earthkit.workflows.backends.earthkit.FieldListBackend)

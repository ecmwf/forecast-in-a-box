from pydantic import BaseModel
from typing import Literal

AnemoiModelCheckpointId = str

class AnemoiModelCheckpoint(BaseModel):
    url: str
    """Where the model can be downloaded from, with a get http client"""
    supported_platforms: list[str] # NOTE question do we want/need/can have this? Either sys.platform output, or torch backend?
    torch_version: str
    python_version: tuple[int, int]
    fields: list[str] # NOTE or quebed? Note this should be a *superset*, ie, the actual fieldlist would be derived by the Catalogue after consulting the user-provided Options which may filter
    # TODO all the other stuff...


DatasourceClient = ["httpGet", "earthkit"] # NOTE this or more? Or just earthkit? Or do we need to subparam earthkit, with like earthkit-mars, earthkit-??? ?
DataSourceId = str

class Datasource(BaseModel):
    client: DatasourceClient
    url_base: str
    """Base URL, extended by the client implementation given a datetime"""
    fields: list[str] # NOTE see the `fields` comment at AnemoiModelCheckpoint. Additionally, we need to handle datetime -- here, or separatedly?

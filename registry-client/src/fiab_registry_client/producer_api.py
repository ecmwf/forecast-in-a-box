from fiab_registry_client.schema import AnemoiModelCheckpointId, Datasource, DatasourceId

def register_anemoi_model_checkpoint(model_url: str, registry_url: str, model_id: AnemoiModelCheckpointId) -> None:
    """Registers the model residing at the given url. The model *must* be accessible
    and parseable from the given environment, because this method does that to derive
    the metadata"""
    raise NotImplementedError

def register_datasource(registry_url: str, datasource: Datasource, datasource_id: DatasourceId) -> None:
    """Registers the given datasource. No validation or check happening"""
    raise NotImplementedError

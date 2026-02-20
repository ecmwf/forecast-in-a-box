from fiab_registry_client.schema import AnemoiModelCheckpoint, AnemoiModelCheckpointId, Datasource, DatasourceId

Entity = tuple[AnemoiModelCheckpointId, AnemoiModelCheckpoint] | tuple[DatasourceId, Datasource]

def get_content(registry_url: str) -> list[Entity]:
    """Retrieves all entities registered at the registry"""
    raise NotImplementedError

from pydantic_settings import BaseSettings, SettingsConfigDict


class FIABSettings(BaseSettings):
    """FIAB Settings"""
    model_config = SettingsConfigDict(env_file=".env", extra='allow')

    mongodb_uri: str
    mongodb_database: str

    api_url: str
    cascade_url: str

class APISettings(FIABSettings):
    data_path: str
    model_repository: str

class CascadeSettings(FIABSettings):
    hosts: int = 1
    workers_per_host: int = 1

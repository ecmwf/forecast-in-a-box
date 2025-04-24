from pydantic_settings import BaseSettings, SettingsConfigDict


class FIABSettings(BaseSettings):
    """FIAB Settings"""
    model_config = SettingsConfigDict(env_file=".env", extra='allow')

    # MongoDB settings
    mongodb_uri: str | None = None 
    """MongoDB URI for connecting to the database, if not provided, a mock database will be used."""
    mongodb_database: str
    """Name of the MongoDB database to use."""

    api_url: str
    """Base URL for the API."""
    cascade_url: str
    """Base URL for the Cascade API."""

    pproc_schema_dir: str | None = None
    """Path to the directory containing the PPROC schema files."""

class APISettings(FIABSettings):
    data_path: str
    """Path to the data directory."""
    model_repository: str
    """URL to the model repository."""

class CascadeSettings(FIABSettings):
    hosts: int = 1
    """Number of hosts for Cascade."""
    workers_per_host: int = 1
    """Number of workers per host for Cascade."""

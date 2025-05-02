from pydantic_settings import BaseSettings, SettingsConfigDict


class BaseSettingsModel(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


class FIABSettings(BaseSettingsModel):
    """FIAB Settings"""

    # MongoDB settings
    mongodb_uri: str | None = None
    """MongoDB URI for connecting to the database, if not provided, a mock database will be used."""
    mongodb_database: str = "fiab"
    """Name of the MongoDB database to use."""

    jwt_secret: str = "fiab_secret"

    pproc_schema_dir: str | None = None
    """Path to the directory containing the PPROC schema files."""


class APISettings(BaseSettingsModel):
    data_path: str = "./data_dir"
    """Path to the data directory."""
    model_repository: str = "https://sites.ecmwf.int/repository/fiab"
    """URL to the model repository."""
    api_url: str = "http://localhost:8000"
    """Base URL for the API."""


class CascadeSettings(BaseSettingsModel):
    max_hosts: int = 1
    """Number of hosts for Cascade."""
    max_workers_per_host: int = 8
    """Number of workers per host for Cascade."""
    cascade_url: str = "tcp://localhost:8067"
    """Base URL for the Cascade API."""


FIAB_SETTINGS = FIABSettings()
API_SETTINGS = APISettings()
CASCADE_SETTINGS = CascadeSettings()


__all__ = [
    "FIAB_SETTINGS",
    "API_SETTINGS",
    "CASCADE_SETTINGS",
]

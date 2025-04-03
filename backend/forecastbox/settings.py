from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache

class Settings(BaseSettings):
    data_path: str
    model_repository: str

    api_url: str
    cascade_url: str
    web_url: str
    mongodb_uri: str
    mongodb_database: str

    model_config = SettingsConfigDict(env_file=".env")

@lru_cache
def get_settings() -> Settings:
    return Settings() # type: ignore

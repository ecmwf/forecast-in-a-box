# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import BaseModel, Field, SecretStr, model_validator
import pathlib

fiab_home = pathlib.Path.home() / ".fiab"


class DatabaseSettings(BaseModel):
    ### ----------------------------------------------------- ###
    ### Database Settings
    ### ----------------------------------------------------- ###

    mongodb_uri: str = "mongodb://localhost:27017"
    """MongoDB URI for connecting to the database"""
    mongodb_database: str = "fiab"
    """Name of the MongoDB database to use."""
    sqlite_userdb_path: str = str(fiab_home / "user.db")
    """Location of the sqlite userdb file"""
    # TODO consider renaming to just userdb_url and make protocol part of it


class GeneralSettings(BaseModel):
    ### ----------------------------------------------------- ###
    ### General Settings
    ### ----------------------------------------------------- ###

    # JWT settings
    jwt_secret: SecretStr = "fiab_secret"
    """Secret key for JWT authentication."""

    # PPROC settings
    pproc_schema_dir: str | None = None
    """Path to the directory containing the PPROC schema files."""

    @model_validator(mode="after")
    def pass_to_secret(self):
        """Convert the jwt_secret to a SecretStr."""
        if isinstance(self.jwt_secret, str):
            self.jwt_secret = SecretStr(self.jwt_secret)
        return self


class BackendAPISettings(BaseModel):
    ### ----------------------------------------------------- ###
    ### Backend API Settings
    ### ----------------------------------------------------- ###

    data_path: str = "./data_dir"
    """Path to the data directory."""
    model_repository: str = "https://sites.ecmwf.int/repository/fiab"
    """URL to the model repository."""
    api_url: str = "http://localhost:8000"
    """Base URL for the API."""


class CascadeSettings(BaseModel):
    ### ----------------------------------------------------- ###
    ### Cascade Settings
    ### ----------------------------------------------------- ###

    max_hosts: int = 1
    """Number of hosts for Cascade."""
    max_workers_per_host: int = 8
    """Number of workers per host for Cascade."""
    cascade_url: str = "tcp://localhost:8067"
    """Base URL for the Cascade API."""
    log_collection_max_size: int = 1000
    """Maximum size of the log collection for Cascade."""
    venv_temp_dir: str = "/tmp"
    """Temporary directory for virtual environments."""


class FIABConfig(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_nested_delimiter="__", env_prefix="fiab__")

    general: GeneralSettings = Field(default_factory=GeneralSettings)
    db: DatabaseSettings = Field(default_factory=DatabaseSettings)
    api: BackendAPISettings = Field(default_factory=BackendAPISettings)
    cascade: CascadeSettings = Field(default_factory=CascadeSettings)


config = FIABConfig()

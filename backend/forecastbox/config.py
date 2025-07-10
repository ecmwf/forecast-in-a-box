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
from cascade.low.func import pydantic_recursive_collect
import urllib.parse
import os

fiab_home = pathlib.Path.home() / ".fiab"


def _validate_url(url: str) -> bool:
    # TODO add DNS resolution attempt or something
    parse = urllib.parse.urlparse(url)
    return parse.scheme and parse.netloc


class DatabaseSettings(BaseModel):
    sqlite_userdb_path: str = str(fiab_home / "user.db")
    """Location of the sqlite file for user auth+info"""
    sqlite_jobdb_path: str = str(fiab_home / "job.db")
    """Location of the sqlite file for job progress tracking"""

    def validate_runtime(self) -> list[str]:
        errors = []
        if not pathlib.Path(self.sqlite_userdb_path).parent.is_dir():
            errors.append(f"parent directory doesnt exist: sqlite_userdb_path={self.sqlite_userdb_path}")
        if not pathlib.Path(self.sqlite_jobdb_path).parent.is_dir():
            errors.append(f"parent directory doesnt exist: sqlite_jobdb_path={self.sqlite_jobdb_path}")
        return errors

    # TODO consider renaming to just userdb_url and make protocol part of it
    # NOTE keep job and user dbs separate -- latter is more sensitive and likely to be externalized


class OIDCSettings(BaseModel):
    client_id: str
    client_secret: SecretStr
    openid_configuration_endpoint: str
    name: str = "oidc"
    scopes: list[str] = ["openid", "email"]
    required_roles: list[str] | None = None

    @model_validator(mode="after")
    def pass_to_secret(self):
        """Convert the client_secret to a SecretStr."""
        if isinstance(self.client_secret, str):
            self.client_secret = SecretStr(self.client_secret)
        return self


class AuthSettings(BaseModel):
    jwt_secret: SecretStr = "fiab_secret"
    """JWT secret key for authentication."""
    oidc: OIDCSettings | None = None
    """OIDC settings for authentication, if applicable, if not given no route will be made."""
    passthrough: bool = False
    """If true, all authentication is ignored. Used for single-user standalone regime"""
    public_url: str | None = None
    """Used for OIDC redirects"""

    @model_validator(mode="after")
    def pass_to_secret(self):
        """Convert the jwt_secret to a SecretStr."""
        if isinstance(self.jwt_secret, str):
            self.jwt_secret = SecretStr(self.jwt_secret)
        if self.oidc is not None and self.public_url is None:
            raise ValueError("when using oidc, public_url must be configured")
        return self

    def validate_runtime(self) -> list[str]:
        errors = []
        if self.public_url is not None:
            errors.append(f"not an url: public_url={self.public_url}")
        return errors


class GeneralSettings(BaseModel):
    pproc_schema_dir: str | None = None
    """Path to the directory containing the PPROC schema files."""

    def validate_runtime(self) -> list[str]:
        if self.pproc_schema_dir and not os.path.isdir(self.pproc_schema_dir):
            return ["not a directory: pproc_schema_dir={self.pproc_schema_dir}"]
        else:
            return []


class BackendAPISettings(BaseModel):
    data_path: str = str(fiab_home / "data_dir")
    """Path to the data directory."""
    model_repository: str = "https://sites.ecmwf.int/repository/fiab"
    """URL to the model repository."""
    uvicorn_host: str = "0.0.0.0"
    """Listening host of the whole server."""
    uvicorn_port: int = 8000
    """Listening port of the whole server."""
    serve_static: bool = True
    """If true, serve static files from the static directory."""

    def local_url(self) -> str:
        return f"http://localhost:{self.uvicorn_port}"

    def validate_runtime(self) -> list[str]:
        errors = []
        if not os.path.isdir(self.data_path):
            errors.append(f"not a directory: data_path={self.data_path}")
        if not _validate_url(self.model_repository):
            errors.append(f"not an url: model_repository={self.model_repository}")
        pseudo_url = f"http://{self.uvicorn_host}:{self.uvicorn_port}"
        if not _validate_url(pseudo_url) or (self.uvicorn_port < 0) or (self.uvicorn_port > 2**16):
            errors.append(f"not a valid uvicorn config: {pseudo_url}")
        return errors


class CascadeSettings(BaseModel):
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

    def validate_runtime(self) -> list[str]:
        errors = []
        if not os.path.isdir(self.venv_temp_dir):
            errors.append(f"not a directory: venv_temp_dir={self.venv_temp_dir}")
        if not _validate_url(self.cascade_url):
            errors.append(f"not an url: cascade_url={self.cascade_url}")
        return errors


class FIABConfig(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_nested_delimiter="__", env_prefix="fiab__")

    general: GeneralSettings = Field(default_factory=GeneralSettings)
    auth: AuthSettings = Field(default_factory=AuthSettings)

    db: DatabaseSettings = Field(default_factory=DatabaseSettings)
    api: BackendAPISettings = Field(default_factory=BackendAPISettings)
    cascade: CascadeSettings = Field(default_factory=CascadeSettings)


def validate_runtime(config: FIABConfig) -> None:
    """Validates that a particular config can be used to execute FIAB in this machine/venv.
    Note this differs from a regular pydantic validation which just checks types etc. For example
    here we check presence/accessibility of databases"""

    errors = pydantic_recursive_collect(config, "validate_runtime")
    if errors:
        errors_formatted = "\n".join(f"at {e[0]}: {e[1]}" for e in errors)
        raise ValueError(f"Errors were found in configuration:\n{errors_formatted}")


config = FIABConfig()

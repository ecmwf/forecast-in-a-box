# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import logging
import os
import threading
import urllib.parse
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Any, Literal, Self

import toml
from cascade.low.func import assert_never, pydantic_recursive_collect
from fiab_core.artifacts import ArtifactStoreId
from fiab_core.fable import PluginCompositeId, PluginId, PluginStoreId
from pydantic import BeforeValidator, Field, PlainSerializer, SecretStr, model_validator
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SettingsConfigDict, TomlConfigSettingsSource

from forecastbox.utility.pydantic import FiabBaseModel

fiab_home = Path(os.environ["FIAB_ROOT"]) if "FIAB_ROOT" in os.environ else (Path.home() / ".fiab")
logger = logging.getLogger(__name__)


def _validate_url(url: str) -> bool:
    # TODO add DNS resolution attempt or something
    parse = urllib.parse.urlparse(url)
    return (parse.scheme is not None) and (parse.netloc is not None)


class StatusMessage:
    """Namespace class for status message sharing"""

    # NOTE this class is here as this is a low place in hierarchy, and we dont want circular imports
    gateway_running = "running"


class ConcurrentPools(StrEnum):
    General = "general"
    Io = "io"
    RunSubmission = "run-submission"
    ArtifactIo = "artifact-io"
    PluginManagement = "plugin-management"
    JobsDb = "jobs-db"


class ConcurrentThreads(StrEnum):
    EventDispatcher = "event-dispatcher"
    Scheduler = "scheduler"
    DatabaseGarbageCollector = "database-garbage-collector"


class PoolSettings(FiabBaseModel):
    max_workers: int = Field(gt=0)
    max_pending: int = Field(gt=0)


def _default_concurrency_pools() -> dict[ConcurrentPools, PoolSettings]:
    return {
        ConcurrentPools.General: PoolSettings(max_workers=2, max_pending=32),
        ConcurrentPools.Io: PoolSettings(max_workers=4, max_pending=64),
        ConcurrentPools.RunSubmission: PoolSettings(max_workers=2, max_pending=32),
        ConcurrentPools.ArtifactIo: PoolSettings(max_workers=1, max_pending=64),
        ConcurrentPools.PluginManagement: PoolSettings(max_workers=1, max_pending=16),
        ConcurrentPools.JobsDb: PoolSettings(max_workers=1, max_pending=128),
    }


class ConcurrencySettings(FiabBaseModel):
    pools: dict[ConcurrentPools, PoolSettings] = Field(default_factory=_default_concurrency_pools)
    failure_history_size: int = Field(default=100, gt=0)
    startup_timeout_seconds: float = Field(default=10, gt=0)
    shutdown_timeout_seconds: float = Field(default=10, gt=0)

    def validate_runtime(self) -> list[str]:
        errors: list[str] = []
        required_pools = set(ConcurrentPools)
        configured_pools = set(self.pools)
        if configured_pools != required_pools:
            missing = sorted(pool.value for pool in required_pools - configured_pools)
            unexpected = sorted(pool.value for pool in configured_pools - required_pools)
            errors.append(f"pools must contain exactly the six required identifiers: missing={missing}, unexpected={unexpected}")
        for pool_name in (ConcurrentPools.JobsDb, ConcurrentPools.ArtifactIo, ConcurrentPools.PluginManagement):
            pool = self.pools.get(pool_name)
            if pool is not None and pool.max_workers != 1:
                errors.append(f"{pool_name.value} must have exactly one worker")
        return errors


class DispatcherSettings(FiabBaseModel):
    queue_capacity: int = Field(default=1024, gt=0)


class DatabaseSettings(FiabBaseModel):
    sqlite_userdb_path: str = str(fiab_home / "user.db")
    """Location of the sqlite file for user auth+info"""
    sqlite_jobdb_path: str = str(fiab_home / "job.db")
    """Location of the sqlite file for the jobs persistence layer: experiments, schedules, executions"""

    def validate_runtime(self) -> list[str]:
        errors = []
        if not Path(self.sqlite_userdb_path).parent.is_dir():
            errors.append(f"parent directory doesnt exist: sqlite_userdb_path={self.sqlite_userdb_path}")
        if not Path(self.sqlite_jobdb_path).parent.is_dir():
            errors.append(f"parent directory doesnt exist: sqlite_jobdb_path={self.sqlite_jobdb_path}")
        return errors

    # TODO consider renaming to just userdb_url and make protocol part of it
    # NOTE keep job and user dbs separate -- latter is more sensitive and likely to be externalized


class OIDCSettings(FiabBaseModel):
    client_id: str | None = None
    client_secret: SecretStr | None = None
    openid_configuration_endpoint: str | None = None
    name: str = "oidc"
    scopes: list[str] = ["openid", "email"]
    required_roles: list[str] | None = None

    @model_validator(mode="after")
    def pass_to_secret(self) -> Self:
        """Convert the client_secret to a SecretStr."""
        if isinstance(self.client_secret, str):
            self.client_secret = SecretStr(self.client_secret)
        return self


class AuthSettings(FiabBaseModel):
    jwt_secret: SecretStr = SecretStr("fiab_secret")
    """JWT secret key for authentication."""
    oidc: OIDCSettings | None = None
    """OIDC settings for authentication, if applicable, if not given no route will be made."""
    passthrough: bool = True
    """If true, all authentication is ignored. Used for single-user standalone regime"""
    public_url: str | None = None
    """Used for OIDC redirects"""
    domain_allowlist_registry: list[str] = Field(default_factory=list)
    """List of allowed domains for user registration. If empty, any domain is allowed."""

    @model_validator(mode="after")
    def pass_to_secret(self) -> Self:  # type: ignore[override]
        """Convert the jwt_secret to a SecretStr."""
        if isinstance(self.jwt_secret, str):
            self.jwt_secret = SecretStr(self.jwt_secret)
        if self.oidc is not None and self.public_url is None:
            raise ValueError("when using oidc, public_url must be configured")
        return self

    def validate_runtime(self) -> list[str]:
        errors = []
        if self.public_url is not None and not _validate_url(self.public_url):
            errors.append(f"not an url: public_url={self.public_url}")
        return errors


PluginRefreshStrategy = Literal["automatic", "manual"]


class PluginSettings(FiabBaseModel):
    """A pip-installable plugin with an importible module"""

    pip_source: str
    """Name of the package if assuming PyPI, or a local path, git repo, ... Anything that pip accepts"""
    module_name: str
    """A string such that `importlib.import_module(module_name)` gives a module that has a `plugin` attribute of type fiab_core.plugin.Plugin`"""
    update_strategy: PluginRefreshStrategy = "manual"
    """Whether we should invoke `pip install --update <plugin>` on every launch, or let user handle that manually or via API"""


PluginCompositeIdReadable = Annotated[
    PluginCompositeId, BeforeValidator(PluginCompositeId.from_str), PlainSerializer(PluginCompositeId.to_str, return_type=str)
]
PluginsSettings = dict[PluginCompositeIdReadable, PluginSettings]


class PluginStoreConfig(FiabBaseModel):
    url: str
    method: Literal["file", "localSingle"]
    """In case of file, the `url` points  to a json parseable as api.plugin.store.PluginStore
    In case of localSingle, the `url` points to a pip-installable location, eg, a folder with pyproject
    In either case the url supports http:// and file:// protocols"""


PluginStoresConfig = dict[PluginStoreId, PluginStoreConfig]


def _default_plugins() -> PluginsSettings:
    return {
        PluginCompositeIdReadable.from_str("ecmwf:ecmwf-base"): PluginSettings(
            pip_source="fiab-plugin-ecmwf",
            module_name="fiab_plugin_ecmwf",
        ),
    }


def _default_plugin_stores() -> PluginStoresConfig:
    return {
        PluginStoreId("ecmwf"): PluginStoreConfig(
            url="https://raw.githubusercontent.com/ecmwf/forecast-in-a-box/refs/heads/main/install/plugins.json",
            method="file",
        ),
    }


class ArtifactStoreConfig(FiabBaseModel):
    url: str
    method: Literal["file", "gittag"]

    @model_validator(mode="after")
    def validate_method_url(self) -> Self:
        if self.method == "gittag" and "${TAG}" not in self.url:
            raise ValueError("for method='gittag', url must contain ${TAG}")
        return self


ArtifactStoresConfig = dict[ArtifactStoreId, ArtifactStoreConfig]


def _default_artifact_stores() -> ArtifactStoresConfig:
    return {
        ArtifactStoreId("ecmwf"): ArtifactStoreConfig(
            url="https://raw.githubusercontent.com/ecmwf/forecast-in-a-box/refs/tags/${TAG}/install/artifacts.json",
            method="gittag",
        ),
    }


class ProductSettings(FiabBaseModel):
    pproc_schema_dir: str | None = None
    """Path to the directory containing the PPROC schema files."""

    plots_schema: str = Field(
        default="inbuilt://fiab",
        description="earthkit-plots global schema",
        examples=["inbuilt://fiab", "my-schema-package@/path/to/my-schema-package", "my-registered-schema"],
    )
    """earthkit-plots global schema, can be registered schema or path to a yaml file,
    If starts with inbuilt:// it is searched in the plots schema dir.
    If contains @ it is considered a package to be installed in the environment
    (e.g. my-schema-package@/path/to/my-schema-package)
    """

    default_input_source: str = "opendata"
    """Default input source for models, if not specified otherwise"""

    def validate_runtime(self) -> list[str]:
        if self.pproc_schema_dir and not os.path.isdir(self.pproc_schema_dir):
            return ["not a directory: pproc_schema_dir={self.pproc_schema_dir}"]
        else:
            return []


class ExternalServicesSettings(FiabBaseModel):
    plugins: PluginsSettings = Field(default_factory=_default_plugins)
    plugin_stores: PluginStoresConfig = Field(default_factory=_default_plugin_stores)
    artifact_stores: ArtifactStoresConfig = Field(default_factory=_default_artifact_stores)
    model_repository: str = "https://sites.ecmwf.int/repository/fiab"
    """URL to the model repository."""

    def validate_runtime(self) -> list[str]:
        errors = []
        if not _validate_url(self.model_repository):
            errors.append(f"not an url: model_repository={self.model_repository}")
        return errors


class BackendSettings(FiabBaseModel):
    data_path: str = f"file://{fiab_home.absolute() / 'data_dir'}"
    """Data directory URL. Supports file:// (local) and ssh://[user@]host/path (remote) schemes."""
    uvicorn_host: str = "0.0.0.0"
    """Listening host of the whole server."""
    uvicorn_port: int = 8000
    """Listening port of the whole server."""
    allow_service: bool = False
    """Whether we assume that a system-level service has been registered. Affects entrypoint.main behaviour"""
    allow_scheduler: bool = False
    """Whether scheduler thread should be started. Best combine with allow_service=True"""
    launch_browser: bool = True
    """Whether a browser window should be opened after start. Used only when
    entrypoint.main.launch_all module is used"""

    def local_url(self) -> str:
        return f"http://localhost:{self.uvicorn_port}"

    def validate_runtime(self) -> list[str]:
        errors = []
        parsed = urllib.parse.urlparse(self.data_path)
        if parsed.scheme == "file":
            if not os.path.isdir(parsed.path):
                errors.append(f"not a directory: data_path={self.data_path}")
        elif parsed.scheme == "ssh":
            if not parsed.netloc:
                errors.append(f"missing host in ssh:// data_path: {self.data_path}")
            if not parsed.path.startswith("/"):
                errors.append(f"ssh:// data_path must have an absolute path: {self.data_path}")
        else:
            errors.append(f"unsupported scheme in data_path (use file:// or ssh://): {self.data_path}")
        pseudo_url = f"http://{self.uvicorn_host}:{self.uvicorn_port}"
        if not _validate_url(pseudo_url) or (self.uvicorn_port < 0) or (self.uvicorn_port > 2**16):
            errors.append(f"not a valid uvicorn config: {pseudo_url}")
        return errors


class SshClusterSpec(FiabBaseModel):
    controller_url: str
    worker_urls: list[str]


class GatewayStartupParams(FiabBaseModel):
    max_concurrent_jobs: int | None = 1
    """If more jobs submitted at a given time, all but this many wait in a queue"""
    cascade_logging_base: str | None = None
    """Where to store logs of cascade gw and jobs. Use eg /home/<user>/fiabLogs or /tmp/fiabLogs"""
    shared_path: str | None = None
    """Shared filesystem path visible to all workers, required for Slurm submissions."""
    ssh_cluster_spec: SshClusterSpec | None = None
    """SSH cluster description for sshCluster submissions."""


class LocalGateway(FiabBaseModel):
    gateway_type: Literal["local"]
    startup_params: GatewayStartupParams = Field(default_factory=GatewayStartupParams)


class RemoteGateway(FiabBaseModel):
    gateway_type: Literal["remote"]
    startup_params: GatewayStartupParams = Field(default_factory=GatewayStartupParams)
    cascade_url: str
    """Sshable url like 'ssh://[<user>@]<hostname>:<port>'"""

    def validate_runtime(self) -> list[str]:
        parsed = urllib.parse.urlparse(self.cascade_url)
        if parsed.scheme != "ssh":
            return [f"unsupported protocol for RemoteGateway cascade_url: {parsed.scheme!r}. Use ssh://"]
        return []


class UnmanagedGateway(FiabBaseModel):
    gateway_type: Literal["unmanaged"]
    cascade_url: str
    """Base URL for the Cascade API, eg tcp://<hostname>:<port>"""


CascadeInfrastructureType = Literal["localProcess", "slurm", "sshCluster"]


class CascadeConstraints(FiabBaseModel):
    default_cascade_infra: CascadeInfrastructureType = "localProcess"
    """Default execution infrastructure for jobs if unspecified in a job."""
    default_hosts: int = 1
    """Default number of hosts for Cascade if unspecified in a job."""
    max_hosts: int = 1
    """Max number of hosts for Cascade."""
    default_workers_per_host: int = 2
    """Default number of workers per hosts for Cascade if unspecified in a job."""
    max_workers_per_host: int = 8
    """Max number of workers per host for Cascade."""


class CascadeSettings(FiabBaseModel):
    gateway: UnmanagedGateway | LocalGateway | RemoteGateway = Field(
        discriminator="gateway_type", default_factory=lambda: LocalGateway(gateway_type="local")
    )
    constraints: CascadeConstraints = Field(default_factory=CascadeConstraints)

    def validate_runtime(self) -> list[str]:
        errors = []
        cascade_url = self._get_cascade_url()
        if not _validate_url(cascade_url):
            errors.append(f"not an url: cascade_url={cascade_url}")
        return errors

    def _get_cascade_url(self) -> str:
        if isinstance(self.gateway, LocalGateway):
            return "tcp://localhost"
        elif isinstance(self.gateway, RemoteGateway):
            return self.gateway.cascade_url
        elif isinstance(self.gateway, UnmanagedGateway):
            return self.gateway.cascade_url
        else:
            assert_never(self.gateway)


class FIABConfig(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_nested_delimiter="__", env_prefix="fiab__", case_sensitive=True)

    product: ProductSettings = Field(default_factory=ProductSettings, description="Product specific settings")

    auth: AuthSettings = Field(default_factory=AuthSettings)

    db: DatabaseSettings = Field(default_factory=DatabaseSettings)
    external: ExternalServicesSettings = Field(default_factory=ExternalServicesSettings)
    backend: BackendSettings = Field(default_factory=BackendSettings)
    cascade: CascadeSettings = Field(default_factory=CascadeSettings)
    concurrency: ConcurrencySettings = Field(default_factory=ConcurrencySettings)
    dispatcher: DispatcherSettings = Field(default_factory=DispatcherSettings)

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        # for tests in particular, we dont want user's ~/.fiab or .env to mess up
        if os.environ.get("FIAB_IGNORE_CONFIG_SOURCES", "0") == "1":
            return (
                env_settings,
                init_settings,
            )
        else:
            return (
                env_settings,
                file_secret_settings,
                dotenv_settings,
                TomlConfigSettingsSource(settings_cls, fiab_home / "config.toml"),
                init_settings,
            )

    def _get_toml(self, **k: Any) -> str:
        json_config = self.model_dump(mode="json", **k)
        toml_config = toml.dumps(json_config)
        return toml_config

    def save_to_file(self) -> None:
        """Save current configuration to toml file"""

        config_path = fiab_home / "config.toml"
        config_path.parent.mkdir(parents=True, exist_ok=True)
        with open(config_path, "w") as f:
            f.write(self._get_toml(exclude_defaults=True, exclude_none=True))

    def validate_runtime(self) -> list[str]:
        cascade_url = self.cascade._get_cascade_url()
        cascade = urllib.parse.urlparse(cascade_url)
        data_path = urllib.parse.urlparse(self.backend.data_path)
        errors = []
        compatible_scheme_pairs = {
            ("tcp", "file"),
            ("ssh", "ssh"),
        }
        if (cascade.scheme, data_path.scheme) not in compatible_scheme_pairs:
            errors.append(f"cascade and data path must use a compatible scheme: {cascade=} != {data_path=}")
        if cascade.scheme == "ssh":
            if cascade.netloc != data_path.netloc:
                errors.append(f"under ssh://, cascade and data path must use the same netloc: {cascade=} != {data_path=}")
        return errors


def validate_runtime(config: FIABConfig) -> None:
    """Validates that a particular config can be used to execute FIAB in this machine/venv.
    Note this differs from a regular pydantic validation which just checks types etc. For example
    here we check presence/accessibility of databases
    """

    errors = pydantic_recursive_collect(config, "validate_runtime")
    if errors:
        errors_formatted = "\n".join(f"at {e[0]}: {e[1]}" for e in errors)
        raise ValueError(f"Errors were found in configuration:\n{errors_formatted}")


config = FIABConfig()
config_edit_lock = threading.Lock()

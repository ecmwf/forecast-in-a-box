# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Individual startup/teardown steps used by `forecastbox.entrypoint.app`'s lifespan, plus the
`build_initializers` factory that assembles them, in order, into an `Initializers` instance.

The order below matters: `initialize()` runs the steps top to bottom, and `shutdown()` unwinds
them bottom to top -- but only the ones that actually started. See
`forecastbox.utility.initializer` for the exact semantics.
"""

import asyncio
import importlib
import inspect
import logging
import pkgutil

from fiab_core.artifacts import ArtifactsProvider

import forecastbox.domain
import forecastbox.schemata
from forecastbox.domain.artifact.base import get_artifact_local_path
from forecastbox.domain.artifact.manager import ArtifactManager, join_artifact_manager, submit_refresh_catalog
from forecastbox.domain.experiment.scheduling.background import start_scheduler, stop_scheduler
from forecastbox.domain.gateway.service import shutdown_processes
from forecastbox.domain.lens.manager import shutdown_all_lens_instances
from forecastbox.domain.lens.proxy import aclose_client as aclose_lens_proxy_client
from forecastbox.domain.notification.service import init_broadcaster
from forecastbox.domain.plugin.store import submit_initialize_stores
from forecastbox.domain.plugin.submit import submit_load_all as submit_load_plugins
from forecastbox.utility.concurrency.manager import execution_manager
from forecastbox.utility.config import ConcurrentThreads, config
from forecastbox.utility.dispatcher import (
    DispatcherRegistration,
    event_dispatcher_entrypoint,
    freeze_registration,
    register_dispatcher,
)
from forecastbox.utility.dispatcher import (
    status as dispatcher_status,
)
from forecastbox.utility.dispatcher import (
    stop_request as dispatcher_stop_request,
)
from forecastbox.utility.initializer import Initializer, Initializers
from forecastbox.utility.tunnel import shutdown as shutdown_tunnels

logger = logging.getLogger(__name__)


async def _start_db_schema() -> None:
    """Create db tables declared by every `forecastbox.schemata` submodule.

    Import every schemata submodule first, and only then call any discovered
    create_db_and_tables. Several domain schema modules share a single Base/engine
    (see forecastbox.schemata.jobs) and declare cross-module foreign keys, so all of
    them must have registered their ORM classes on that shared metadata before any
    create_db_and_tables runs -- calling it mid-iteration could create the database
    with tables missing simply because their module hadn't been imported yet.
    """
    pending_create_db_and_tables = []
    for module_info in pkgutil.iter_modules(forecastbox.schemata.__path__):
        module = importlib.import_module(f"forecastbox.schemata.{module_info.name}")
        if hasattr(module, "create_db_and_tables"):
            pending_create_db_and_tables.append(module.create_db_and_tables)
    for create_db_and_tables in pending_create_db_and_tables:
        result = create_db_and_tables()  # type: ignore[call-non-callable] # NOTE no module protocol
        if inspect.isawaitable(result):
            result = await result
        if result is not None:
            logger.warning(f"unexpected result from create_db_and_tables: {result.__class__}")


def _discover_dispatchers() -> None:
    for package_info in pkgutil.iter_modules(forecastbox.domain.__path__):
        if not package_info.ispkg:
            continue
        module_name = f"forecastbox.domain.{package_info.name}.dispatchers"
        try:
            module = importlib.import_module(module_name)
        except ModuleNotFoundError as error:
            if error.name == module_name:
                continue
            raise
        registrations = getattr(module, "dispatchers", None)
        if not isinstance(registrations, tuple):
            raise TypeError(f"{module_name} must export a dispatchers tuple")
        for registration in registrations:
            if not isinstance(registration, DispatcherRegistration):
                raise TypeError(f"{module_name} contains a malformed dispatcher registration")
            register_dispatcher(registration)
    freeze_registration()


def _start_execution_runtime() -> None:
    try:
        _discover_dispatchers()
        for pool_name, settings in config.backend.concurrency.pools.items():
            logger.debug(f"registering {pool_name=}")
            execution_manager.register_pool(
                pool_name,
                max_workers=settings.max_workers,
                max_pending=settings.max_pending,
                stage=0,
            )
        logger.debug("registering event dispatcher thread")
        execution_manager.register_thread(
            ConcurrentThreads.EventDispatcher,
            event_dispatcher_entrypoint,
            status_provider=dispatcher_status,
            stop_request=dispatcher_stop_request,
            stage=0,
        )
        execution_manager.start(timeout=config.backend.concurrency.startup_timeout_seconds)
    except BaseException:
        # NOTE partial registration may have happened above -- make sure it's cleaned up, since
        # from the Initializers' point of view this step either fully started, or not at all.
        execution_manager.shutdown(timeout=config.backend.concurrency.shutdown_timeout_seconds)
        raise


def _stop_execution_runtime() -> None:
    execution_manager.shutdown(timeout=config.backend.concurrency.shutdown_timeout_seconds)


def _start_broadcaster() -> None:
    init_broadcaster(asyncio.get_running_loop())


def _start_artifact_stores() -> None:
    submit_initialize_stores()


def _start_artifact_provider() -> None:
    ArtifactsProvider.register_get_artifacts_lookup(lambda: ArtifactManager.catalog)
    ArtifactsProvider.register_get_artifact_local_path(lambda composite_id: get_artifact_local_path(composite_id, config.backend.data_path))


def _start_artifact_manager_plugin_catalog() -> None:
    # TODO -- split in two, but there is a dependency between them!
    catalog_ready = submit_refresh_catalog()
    submit_load_plugins(start_after=catalog_ready)


def _stop_artifact_manager_plugin_catalog() -> None:
    join_artifact_manager(timeout_sec=10)


def _start_scheduler() -> None:
    # TODO delay the start until plugins are ready
    start_scheduler()


def _stop_scheduler() -> None:
    stop_scheduler()


def _stop_tunnels() -> None:
    shutdown_tunnels()


async def _stop_processes() -> None:
    await shutdown_processes()


def _stop_lens() -> None:
    shutdown_all_lens_instances()


async def _stop_lens_proxy_client() -> None:
    await aclose_lens_proxy_client()


def build_initializers() -> Initializers:
    """Assemble the ordered list of startup/teardown steps for the application lifespan.

    `initialize()` runs these top to bottom; `shutdown()` unwinds them bottom to top, only
    for the steps that actually started. See `forecastbox.utility.initializer.Initializers`.
    """
    initializers = [
        Initializer("db_schema", start=_start_db_schema),
        Initializer("execution_runtime", start=_start_execution_runtime, stop=_stop_execution_runtime),
        Initializer("broadcaster", start=_start_broadcaster),
        Initializer("artifact_stores", start=_start_artifact_stores),
        Initializer("artifact_provider", start=_start_artifact_provider),
        Initializer(
            "artifact_manager_plugin_catalog",
            start=_start_artifact_manager_plugin_catalog,
            stop=_stop_artifact_manager_plugin_catalog,
        ),
    ]
    if config.backend.allow_scheduler:
        initializers.append(Initializer("scheduler", start=_start_scheduler, stop=_stop_scheduler))
    initializers.extend(
        [
            Initializer("tunnels", stop=_stop_tunnels),
            Initializer("processes", stop=_stop_processes),
            Initializer("lens", stop=_stop_lens),
            Initializer("lens_proxy_client", stop=_stop_lens_proxy_client),
        ]
    )
    return Initializers(initializers)

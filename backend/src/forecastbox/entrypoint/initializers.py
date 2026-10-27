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
import threading
from collections.abc import Callable, Sequence
from concurrent.futures import Future
from typing import TypeVar

from fiab_core.artifacts import ArtifactsProvider
from fiab_core.metkit import MetkitParamResolver

import forecastbox.domain
import forecastbox.schemata
from forecastbox.domain.artifact.base import get_artifact_local_path
from forecastbox.domain.artifact.manager import ArtifactManager, submit_refresh_catalog
from forecastbox.domain.experiment.scheduling.runtime import (
    SCHEDULER_STOP_TIMEOUT_SECONDS,
    arm_start_gate,
    scheduler_entrypoint,
    scheduler_status,
    scheduler_stop_request,
)
from forecastbox.domain.gateway.service import ensure_gateway, launch_gateway, shutdown_processes
from forecastbox.domain.lens.manager import shutdown_all_lens_instances
from forecastbox.domain.notification.service import init_broadcaster
from forecastbox.domain.plugin.store import submit_initialize_stores
from forecastbox.domain.plugin.submit import submit_load_all as submit_load_plugins
from forecastbox.utility.concurrency.manager import ConcurrentPools, TaskName, execution_manager
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
from forecastbox.utility.http_pools import start_http_pools, stop_http_pools
from forecastbox.utility.initializer import Initializer, Initializers
from forecastbox.utility.metkit import param_id_to_shortname, shortname_to_param_id
from forecastbox.utility.tunnel import shutdown as shutdown_tunnels

logger = logging.getLogger(__name__)


async def start_db_schema() -> None:
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


def _register_scheduler() -> None:
    if not config.backend.allow_scheduler:
        return
    arm_start_gate(SchedulerPrerequisitesMet)
    execution_manager.register_thread(
        ConcurrentThreads.Scheduler,
        scheduler_entrypoint,
        status_provider=scheduler_status,
        stop_request=scheduler_stop_request,
        stage=1,
    )


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
        _register_scheduler()
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


def register_fiabcore_providers() -> None:
    ArtifactsProvider.register_get_artifacts_lookup(lambda: ArtifactManager.catalog)
    ArtifactsProvider.register_get_artifact_local_path(lambda composite_id: get_artifact_local_path(composite_id, config.backend.data_path))
    MetkitParamResolver.register_param_id_to_shortname(param_id_to_shortname)
    MetkitParamResolver.register_shortname_to_param_id(shortname_to_param_id)


# The two barriers below let independent `Initializer` steps be gated on one another
# without coupling their domain functions together (see `submit_load_all`, which is
# unaware that its `start_after` future ultimately traces back to the artifact catalog
# refresh, and the scheduler, which is unaware of the plugin catalog at all).
#
# Each barrier is acked with the *same outcome* as the upstream step it is attached to,
# via `_forward_to_barrier`: a successful upstream resolves the barrier with `None`, a
# failed (or cancelled) upstream resolves the barrier with that same failure. This way,
# a step gated on a barrier observes a failure early (and can choose to log-and-skip, as
# the scheduler does) rather than blocking forever or failing later on some
# unrelated `None` value.
#
# TODO rework into better alignment with execution manager / initializers after concurrency migration concluded
# In particular, we dont want to consume a thread by awaiting on a future, we want sequential task graphs
ArtifactsCatalogInitialized: Future[None] = Future()
PluginsCatalogInitialized: Future[None] = Future()
SchedulerPrerequisitesMet: Future[None] = Future()
_T = TypeVar("_T")


def _forward_to_barrier(barrier: Future[None]) -> Callable[[Future[_T]], None]:
    """Build a done-callback that forwards the outcome of the future it is attached to
    onto ``barrier`` (success, failure, or cancellation alike). Intended to be cheap and
    non-blocking, so it can run on whichever thread completes the upstream future.
    """

    def _forward(done: Future[_T]) -> None:
        if barrier.done():
            return
        if done.cancelled():
            barrier.cancel()
            return
        error = done.exception()
        if error is not None:
            barrier.set_exception(error)
        else:
            barrier.set_result(None)

    return _forward


def _forward_all_to_barrier(barrier: Future[None], upstreams: Sequence[Future[None]]) -> None:
    """Resolve ``barrier`` with None once all ``upstreams`` succeeded, or with the first failure
    or cancellation. Uses non-blocking done-callbacks."""
    lock = threading.Lock()
    remaining = len(upstreams)

    def _on_done(done: Future[None]) -> None:
        nonlocal remaining
        with lock:
            if barrier.done():
                return
            if done.cancelled():
                barrier.cancel()
                return
            error = done.exception()
            if error is not None:
                barrier.set_exception(error)
                return
            remaining -= 1
            if remaining == 0:
                barrier.set_result(None)

    for upstream in upstreams:
        upstream.add_done_callback(_on_done)


def _start_artifact_manager() -> None:
    catalog_ready = submit_refresh_catalog()
    catalog_ready.add_done_callback(_forward_to_barrier(ArtifactsCatalogInitialized))


def _start_plugin_catalog() -> None:
    plugins_ready = submit_load_plugins(start_after=ArtifactsCatalogInitialized)
    plugins_ready.add_done_callback(_forward_to_barrier(PluginsCatalogInitialized))


GatewayInitialized: Future[None] = Future()
_forward_all_to_barrier(SchedulerPrerequisitesMet, [PluginsCatalogInitialized, GatewayInitialized])


def _run_gateway_startup() -> None:
    launch_gateway()
    ensure_gateway()


def _start_gateway() -> None:
    startup = execution_manager.submit_unmonitored(ConcurrentPools.General, TaskName("gateway.start"), _run_gateway_startup)
    startup.add_done_callback(_forward_to_barrier(GatewayInitialized))


def _stop_scheduler() -> None:
    execution_manager.stop_thread(ConcurrentThreads.Scheduler, timeout=SCHEDULER_STOP_TIMEOUT_SECONDS)


def _stop_tunnels() -> None:
    shutdown_tunnels()


async def _stop_processes() -> None:
    await shutdown_processes()


def _stop_lens() -> None:
    shutdown_all_lens_instances()


def build_initializers() -> Initializers:
    """Assemble the ordered list of startup/teardown steps for the application lifespan.

    `initialize()` runs these top to bottom; `shutdown()` unwinds them bottom to top, only
    for the steps that actually started. See `forecastbox.utility.initializer.Initializers`.
    """
    initializers = [
        Initializer("db_schema", start=start_db_schema),
        Initializer("execution_runtime", start=_start_execution_runtime, stop=_stop_execution_runtime),
        Initializer("http_pools", start=start_http_pools, stop=stop_http_pools),
        Initializer("broadcaster", start=_start_broadcaster),
        Initializer("artifact_stores", start=_start_artifact_stores),
        Initializer("fiabcore_providers", start=register_fiabcore_providers),
        Initializer("artifact_manager", start=_start_artifact_manager),
        Initializer("plugin_catalog", start=_start_plugin_catalog),
        Initializer("gateway", start=_start_gateway),
    ]
    if config.backend.allow_scheduler:
        initializers.append(Initializer("scheduler", stop=_stop_scheduler))
    initializers.extend(
        [
            Initializer("tunnels", stop=_stop_tunnels),
            Initializer("processes", stop=_stop_processes),
            Initializer("lens", stop=_stop_lens),
        ]
    )
    return Initializers(initializers)

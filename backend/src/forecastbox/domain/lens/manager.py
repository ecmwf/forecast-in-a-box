# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Lens domain -- managing external inspection tool processes (Lens Instances).

Lenses are external processes (e.g. skinnyWMS) that allow interactive inspection
of Run outputs. This module manages their lifecycle: starting, monitoring, and stopping.

Synchronization uses a single lock protecting the LensInstanceManager's instances map.
Pyrsistent immutable structures allow safe lock-free reads.
"""

import logging
import os
import subprocess
import threading
import uuid
from dataclasses import dataclass
from typing import Any, Literal, NewType

from cascade.low.func import assert_never
from pyrsistent import pmap
from pyrsistent.typing import PMap

from forecastbox.utility.concurrent import FreePortsManager, shutdown_popen, timed_acquire
from forecastbox.utility.pydantic import FiabBaseModel

logger = logging.getLogger(__name__)

LensInstanceId = NewType("LensInstanceId", str)
LensName = Literal["skinnyWMS"]

timeout_acquire = 1


class LensStatus(FiabBaseModel):
    status: Literal["starting", "running", "terminated", "failed"]
    lens_name: LensName
    lens_params: dict[str, Any]


@dataclass
class LensInstance:
    process: subprocess.Popen[bytes] | None
    lens_params: dict[str, Any]
    lens_name: LensName
    ports: set[int]


class LensInstanceManager:
    lock: threading.Lock = threading.Lock()
    instances: PMap[LensInstanceId, LensInstance] = pmap()


def _compute_status(instance: LensInstance) -> LensStatus:
    if instance.lens_name == "skinnyWMS":
        if instance.process is None:
            status: Literal["starting", "running", "terminated", "failed"] = "starting"
        elif instance.process.poll() is None:
            status = "running"
        elif instance.process.returncode == 0:
            status = "terminated"
        else:
            status = "failed"
    else:
        assert_never(instance.lens_name)

    return LensStatus(status=status, lens_name=instance.lens_name, lens_params=instance.lens_params)


def start_skinny_wms(local_path: str) -> LensInstanceId:
    """Start a skinnyWMS instance serving the given local_path.

    Claims a port, registers the instance (process=None while starting), spawns
    the process via uv, then updates the instance with the running process.
    If the instance was removed from the manager during startup, shuts down the
    process and raises RuntimeError.
    """
    port = FreePortsManager.claim_port()
    instance_id = LensInstanceId(str(uuid.uuid4()))
    instance = LensInstance(
        process=None,
        lens_params={"local_path": local_path},
        lens_name="skinnyWMS",
        ports={port},
    )

    with timed_acquire(LensInstanceManager.lock, timeout_acquire) as acquired:
        if not acquired:
            FreePortsManager.release_port(port)
            raise TimeoutError("Failed to acquire lens manager lock")
        LensInstanceManager.instances = LensInstanceManager.instances.set(instance_id, instance)

    cmd = ["uv", "run", "skinny-wms", "--path", local_path]
    env = {**os.environ, "SKINNYWMS_PORT": str(port), "SKINNYWMS_HOST": "127.0.0.1"}
    process: subprocess.Popen[bytes] = subprocess.Popen(
        cmd,
        env=env,
        start_new_session=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    with timed_acquire(LensInstanceManager.lock, timeout_acquire) as acquired:
        if not acquired:
            shutdown_popen(process)
            FreePortsManager.release_port(port)
            raise TimeoutError("Failed to acquire lens manager lock for update")
        if instance_id not in LensInstanceManager.instances:
            shutdown_popen(process)
            FreePortsManager.release_port(port)
            raise RuntimeError(f"Lens instance {instance_id} was removed during startup")
        updated = LensInstance(
            process=process,
            lens_params=instance.lens_params,
            lens_name=instance.lens_name,
            ports=instance.ports,
        )
        LensInstanceManager.instances = LensInstanceManager.instances.set(instance_id, updated)

    return instance_id


def get_status(instance_id: LensInstanceId) -> LensStatus:
    """Return the status of a lens instance. Raises KeyError if not found."""
    instance = LensInstanceManager.instances.get(instance_id)
    if instance is None:
        raise KeyError(instance_id)
    return _compute_status(instance)


def list_instances() -> list[tuple[LensInstanceId, LensStatus]]:
    """Return all lens instances with their current status. Lock-free read."""
    instances = LensInstanceManager.instances
    return [(iid, _compute_status(inst)) for iid, inst in instances.items()]


def stop_instance(instance_id: LensInstanceId) -> None:
    """Stop and remove a lens instance, releasing its ports.

    Raises KeyError if the instance is not found.
    The port is always released in a finally block to prevent leaks.
    """
    instance: LensInstance | None = None
    try:
        with timed_acquire(LensInstanceManager.lock, timeout_acquire) as acquired:
            if not acquired:
                raise TimeoutError("Failed to acquire lens manager lock")
            if instance_id not in LensInstanceManager.instances:
                raise KeyError(instance_id)
            instance = LensInstanceManager.instances[instance_id]
            LensInstanceManager.instances = LensInstanceManager.instances.remove(instance_id)
        if instance.process is not None:
            shutdown_popen(instance.process)
    finally:
        if instance is not None:
            for port in instance.ports:
                FreePortsManager.release_port(port)


def shutdown_all_instances() -> None:
    """Stop all running lens instances. Used during application shutdown."""
    instances = LensInstanceManager.instances
    for instance_id in list(instances.keys()):
        try:
            stop_instance(instance_id)
        except KeyError:
            pass  # already removed
        except Exception as e:
            logger.warning(f"Failed to stop lens instance {instance_id} during shutdown: {repr(e)}")

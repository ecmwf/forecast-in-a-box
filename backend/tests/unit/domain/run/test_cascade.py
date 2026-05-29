from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest

import forecastbox.domain.run.cascade as run_cascade
from forecastbox.domain.blueprint.cascade import EnvironmentSpecification
from forecastbox.utility.config import (
    CascadeConstraints,
    GatewayStartupParams,
    LocalGateway,
    SshClusterSpec,
    UnmanagedGateway,
    config,
)


@dataclass(frozen=True, slots=True)
class _FakeLocalProcesses:
    workers_per_host: int
    hosts: int


@dataclass(frozen=True, slots=True)
class _FakeSlurmCluster:
    workers_per_host: int
    hosts: int


@dataclass(frozen=True, slots=True)
class _FakeSshCluster:
    controller_url: str
    worker_urls: list[str]
    workers_per_host: int


@dataclass(frozen=True, slots=True)
class _FakeJobSpec:
    infra_spec: Any
    envvars: dict[str, str]
    job_instance: Any


@dataclass(frozen=True, slots=True)
class _FakeSubmitJobRequest:
    job: _FakeJobSpec


@dataclass(frozen=True, slots=True)
class _FakeJobInstanceRich:
    jobInstance: Any
    checkpointSpec: Any


def _spec_with_environment(environment: EnvironmentSpecification) -> run_cascade.ExecutionSpecification:
    return run_cascade.ExecutionSpecification.model_construct(
        job=run_cascade.RawCascadeJob.model_construct(job_type="raw_cascade_job", job_instance=object()),
        environment=environment,
        shared=False,
    )


@pytest.fixture
def patch_submit_stack(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    captures: dict[str, Any] = {}

    def _fake_request_response(request: _FakeSubmitJobRequest, url: str) -> str:
        captures["request"] = request
        captures["url"] = url
        return "ok"

    monkeypatch.setattr(run_cascade, "LocalProcesses", _FakeLocalProcesses)
    monkeypatch.setattr(run_cascade, "SlurmCluster", _FakeSlurmCluster)
    monkeypatch.setattr(run_cascade, "SshCluster", _FakeSshCluster)
    monkeypatch.setattr(run_cascade, "JobSpec", _FakeJobSpec)
    monkeypatch.setattr(run_cascade, "SubmitJobRequest", _FakeSubmitJobRequest)
    monkeypatch.setattr(run_cascade, "JobInstanceRich", _FakeJobInstanceRich)
    monkeypatch.setattr(run_cascade, "request_response", _fake_request_response)
    monkeypatch.setattr(run_cascade, "get_gateway_url", lambda: "tcp://gateway")

    return captures


def test_execute_cascade_uses_config_default_infra_when_unset(patch_submit_stack: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config.cascade, "constraints", CascadeConstraints(default_cascade_infra="slurm"))
    monkeypatch.setattr(config.cascade, "gateway", UnmanagedGateway(gateway_type="unmanaged", cascade_url="tcp://gw"))

    response = run_cascade.execute_cascade(_spec_with_environment(EnvironmentSpecification()))

    assert response == "ok"
    request = patch_submit_stack["request"]
    assert isinstance(request.job.infra_spec, _FakeSlurmCluster)


def test_execute_cascade_explicit_env_infra_overrides_default(patch_submit_stack: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config.cascade, "constraints", CascadeConstraints(default_cascade_infra="slurm"))
    monkeypatch.setattr(config.cascade, "gateway", UnmanagedGateway(gateway_type="unmanaged", cascade_url="tcp://gw"))
    environment = EnvironmentSpecification(cascade_infra="localProcess")

    response = run_cascade.execute_cascade(_spec_with_environment(environment))

    assert response == "ok"
    request = patch_submit_stack["request"]
    assert isinstance(request.job.infra_spec, _FakeLocalProcesses)


def test_execute_cascade_slurm_requires_shared_path_for_managed_gateway(
    patch_submit_stack: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(config.cascade, "constraints", CascadeConstraints(default_cascade_infra="localProcess"))
    monkeypatch.setattr(
        config.cascade,
        "gateway",
        LocalGateway(
            gateway_type="local",
            startup_params=GatewayStartupParams(shared_path=None),
        ),
    )
    environment = EnvironmentSpecification(cascade_infra="slurm")

    with pytest.raises(ValueError, match="shared_path"):
        run_cascade.execute_cascade(_spec_with_environment(environment))


def test_execute_cascade_slurm_allows_managed_gateway_when_shared_path_set(
    patch_submit_stack: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(config.cascade, "constraints", CascadeConstraints(default_cascade_infra="localProcess"))
    monkeypatch.setattr(
        config.cascade,
        "gateway",
        LocalGateway(
            gateway_type="local",
            startup_params=GatewayStartupParams(shared_path="/mnt/shared"),
        ),
    )
    environment = EnvironmentSpecification(cascade_infra="slurm")

    response = run_cascade.execute_cascade(_spec_with_environment(environment))

    assert response == "ok"
    request = patch_submit_stack["request"]
    assert isinstance(request.job.infra_spec, _FakeSlurmCluster)


def test_execute_cascade_slurm_does_not_require_shared_path_for_unmanaged_gateway(
    patch_submit_stack: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(config.cascade, "constraints", CascadeConstraints(default_cascade_infra="localProcess"))
    monkeypatch.setattr(config.cascade, "gateway", UnmanagedGateway(gateway_type="unmanaged", cascade_url="tcp://gw"))
    environment = EnvironmentSpecification(cascade_infra="slurm")

    response = run_cascade.execute_cascade(_spec_with_environment(environment))

    assert response == "ok"
    request = patch_submit_stack["request"]
    assert isinstance(request.job.infra_spec, _FakeSlurmCluster)


def test_execute_cascade_ssh_cluster_requires_spec(patch_submit_stack: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config.cascade, "constraints", CascadeConstraints(default_cascade_infra="localProcess"))
    monkeypatch.setattr(config.cascade, "gateway", UnmanagedGateway(gateway_type="unmanaged", cascade_url="tcp://gw"))
    environment = EnvironmentSpecification(cascade_infra="sshCluster")

    with pytest.raises(ValueError, match="ssh_cluster_spec"):
        run_cascade.execute_cascade(_spec_with_environment(environment))


def test_execute_cascade_ssh_cluster_uses_gateway_spec(patch_submit_stack: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config.cascade, "constraints", CascadeConstraints(default_cascade_infra="localProcess"))
    monkeypatch.setattr(
        config.cascade,
        "gateway",
        LocalGateway(
            gateway_type="local",
            startup_params=GatewayStartupParams(
                ssh_cluster_spec=SshClusterSpec(
                    controller_url="ssh://controller",
                    worker_urls=["ssh://worker-1", "ssh://worker-2"],
                )
            ),
        ),
    )
    environment = EnvironmentSpecification(cascade_infra="sshCluster", workers_per_host=3)

    response = run_cascade.execute_cascade(_spec_with_environment(environment))

    assert response == "ok"
    request = patch_submit_stack["request"]
    assert isinstance(request.job.infra_spec, _FakeSshCluster)
    assert request.job.infra_spec.controller_url == "ssh://controller"
    assert request.job.infra_spec.worker_urls == ["ssh://worker-1", "ssh://worker-2"]
    assert request.job.infra_spec.workers_per_host == 3

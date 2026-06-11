# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the lens domain manager."""

import pathlib
import subprocess
from collections.abc import Iterator
from unittest.mock import MagicMock, patch

import pytest
from pyrsistent import pmap

from forecastbox.domain.lens.manager import (
    LensInstance,
    LensInstanceDetail,
    LensInstanceId,
    LensInstanceManager,
    _compute_status,
    _expand_local_path,
    get_status,
    list_instances,
    local_path_available,
    shutdown_all_lens_instances,
    stop_instance,
)
from forecastbox.utility.concurrent import FreePortsManager, NoFreePortsException


@pytest.fixture(autouse=True)
def reset_lens_manager() -> Iterator[None]:
    """Reset manager state and port pool between tests."""
    original_instances = LensInstanceManager.instances
    original_ports = FreePortsManager.free_ports.copy()
    yield
    LensInstanceManager.instances = original_instances
    FreePortsManager.free_ports = original_ports


def _make_instance(process: subprocess.Popen | None = None, returncode: int | None = None) -> LensInstance:
    if process is None and returncode is not None:
        mock_proc = MagicMock(spec=subprocess.Popen)
        mock_proc.poll.return_value = returncode
        mock_proc.returncode = returncode
        process = mock_proc
    return LensInstance(
        process=process,
        lens_params={"local_path": "/data"},
        lens_name="skinnyWMS",
        ports={19000},
    )


class TestComputeStatus:
    def test_no_process_is_starting(self) -> None:
        instance = _make_instance(process=None)
        status = _compute_status(instance)
        assert status.status == "starting"
        assert status.lens_name == "skinnyWMS"
        assert status.lens_params == {"local_path": "/data"}

    def test_running_process_is_running(self) -> None:
        mock_proc = MagicMock(spec=subprocess.Popen)
        mock_proc.poll.return_value = None  # still alive
        instance = _make_instance(process=mock_proc)
        assert _compute_status(instance).status == "running"

    def test_process_exited_zero_is_terminated(self) -> None:
        instance = _make_instance(returncode=0)
        assert _compute_status(instance).status == "terminated"

    def test_process_exited_nonzero_is_failed(self) -> None:
        instance = _make_instance(returncode=1)
        assert _compute_status(instance).status == "failed"

    def test_process_exited_negative_is_failed(self) -> None:
        instance = _make_instance(returncode=-15)
        assert _compute_status(instance).status == "failed"


class TestGetStatus:
    def test_raises_key_error_for_unknown_id(self) -> None:
        with pytest.raises(KeyError):
            get_status(LensInstanceId("no-such-id"))

    def test_returns_status_for_known_id(self) -> None:
        iid = LensInstanceId("test-id")
        instance = _make_instance(process=None)
        LensInstanceManager.instances = pmap({iid: instance})
        result = get_status(iid)
        assert isinstance(result, LensInstanceDetail)
        assert result.status == "starting"


class TestListInstances:
    def test_empty_returns_empty_list(self) -> None:
        LensInstanceManager.instances = pmap()
        assert list_instances() == []

    def test_returns_all_instances_with_status(self) -> None:
        iid1 = LensInstanceId("id-1")
        iid2 = LensInstanceId("id-2")
        mock_alive = MagicMock(spec=subprocess.Popen)
        mock_alive.poll.return_value = None
        LensInstanceManager.instances = pmap(
            {
                iid1: _make_instance(process=None),
                iid2: _make_instance(process=mock_alive),
            }
        )
        results = list_instances()
        assert len(results) == 2
        statuses = {iid: s.status for iid, s in results}
        assert statuses[iid1] == "starting"
        assert statuses[iid2] == "running"


class TestStopInstance:
    def test_raises_key_error_for_unknown_id(self) -> None:
        LensInstanceManager.instances = pmap()
        with pytest.raises(KeyError):
            stop_instance(LensInstanceId("ghost"))

    def test_removes_instance_from_manager(self) -> None:
        iid = LensInstanceId("to-stop")
        LensInstanceManager.instances = pmap({iid: _make_instance(process=None)})
        FreePortsManager.free_ports = set()
        stop_instance(iid)
        assert iid not in LensInstanceManager.instances

    def test_releases_port_on_success(self) -> None:
        iid = LensInstanceId("port-release")
        instance = _make_instance(process=None)
        port = next(iter(instance.ports))
        LensInstanceManager.instances = pmap({iid: instance})
        FreePortsManager.free_ports = set()
        stop_instance(iid)
        assert port in FreePortsManager.free_ports

    def test_shuts_down_running_process(self) -> None:
        iid = LensInstanceId("with-process")
        mock_proc = MagicMock(spec=subprocess.Popen)
        mock_proc.poll.return_value = None
        instance = LensInstance(
            process=mock_proc,
            lens_params={"local_path": "/data"},
            lens_name="skinnyWMS",
            ports={19005},
        )
        LensInstanceManager.instances = pmap({iid: instance})
        FreePortsManager.free_ports = set()
        with patch("forecastbox.domain.lens.manager.shutdown_popen") as mock_shutdown:
            stop_instance(iid)
        mock_shutdown.assert_called_once_with(mock_proc)

    def test_releases_port_even_when_shutdown_raises(self) -> None:
        iid = LensInstanceId("error-case")
        mock_proc = MagicMock(spec=subprocess.Popen)
        mock_proc.poll.return_value = None
        instance = LensInstance(
            process=mock_proc,
            lens_params={"local_path": "/data"},
            lens_name="skinnyWMS",
            ports={19010},
        )
        LensInstanceManager.instances = pmap({iid: instance})
        FreePortsManager.free_ports = set()
        with patch("forecastbox.domain.lens.manager.shutdown_popen", side_effect=RuntimeError("boom")):
            with pytest.raises(RuntimeError):
                stop_instance(iid)
        assert 19010 in FreePortsManager.free_ports


class TestShutdownAllInstances:
    def test_stops_all_instances(self) -> None:
        iid1 = LensInstanceId("all-1")
        iid2 = LensInstanceId("all-2")
        LensInstanceManager.instances = pmap(
            {
                iid1: _make_instance(process=None),
                iid2: _make_instance(process=None),
            }
        )
        FreePortsManager.free_ports = set()
        shutdown_all_lens_instances()
        assert LensInstanceManager.instances == pmap()

    def test_continues_after_individual_failure(self) -> None:
        iid1 = LensInstanceId("fail-1")
        iid2 = LensInstanceId("ok-2")
        LensInstanceManager.instances = pmap(
            {
                iid1: _make_instance(process=None),
                iid2: _make_instance(process=None),
            }
        )
        FreePortsManager.free_ports = set()

        original_stop = stop_instance
        call_count = [0]

        def flaky_stop(iid: LensInstanceId) -> None:
            call_count[0] += 1
            if call_count[0] == 1:
                raise RuntimeError("transient failure")
            original_stop(iid)

        with patch("forecastbox.domain.lens.manager.stop_instance", side_effect=flaky_stop):
            shutdown_all_lens_instances()  # should not raise


class TestFreePortsManager:
    def test_claim_returns_port(self) -> None:
        FreePortsManager.free_ports = {19050}
        port = FreePortsManager.claim_port()
        assert port == 19050
        assert 19050 not in FreePortsManager.free_ports

    def test_claim_raises_when_empty(self) -> None:
        FreePortsManager.free_ports = set()
        with pytest.raises(NoFreePortsException):
            FreePortsManager.claim_port()

    def test_release_adds_port_back(self) -> None:
        FreePortsManager.free_ports = set()
        FreePortsManager.release_port(19055)
        assert 19055 in FreePortsManager.free_ports


class TestLocalPathExpansion:
    """Path resolution for lens inputs: plain files, earthkit file-patterns
    (`…[shortName].grib2`), directories, and missing paths."""

    def test_plain_existing_file_is_returned_directly(self, tmp_path: pathlib.Path) -> None:
        f = tmp_path / "run__1.grib2"
        f.write_bytes(b"GRIB")
        assert _expand_local_path(str(f)) == [str(f)]
        assert local_path_available(str(f))

    def test_pattern_expands_to_all_written_files(self, tmp_path: pathlib.Path) -> None:
        for short_name in ("2t", "msl"):
            (tmp_path / f"run__1__{short_name}.grib2").write_bytes(b"GRIB")
        pattern = str(tmp_path / "run__1__[shortName].grib2")
        assert _expand_local_path(pattern) == sorted([str(tmp_path / "run__1__2t.grib2"), str(tmp_path / "run__1__msl.grib2")])
        assert local_path_available(pattern)

    def test_any_pattern_keys_expand(self, tmp_path: pathlib.Path) -> None:
        # earthkit patterns are not limited to [shortName] — every [key] globs.
        for name in ("run__500__t.grib2", "run__850__q.grib2"):
            (tmp_path / name).write_bytes(b"GRIB")
        pattern = str(tmp_path / "run__[level]__[shortName].grib2")
        assert _expand_local_path(pattern) == sorted([str(tmp_path / "run__500__t.grib2"), str(tmp_path / "run__850__q.grib2")])
        assert local_path_available(str(tmp_path / "run__[level]__t.grib2"))

    def test_directory_is_served_as_is(self, tmp_path: pathlib.Path) -> None:
        assert _expand_local_path(str(tmp_path)) == []
        assert local_path_available(str(tmp_path))

    def test_missing_plain_path_is_unavailable(self, tmp_path: pathlib.Path) -> None:
        missing = str(tmp_path / "not_written_yet.grib2")
        assert _expand_local_path(missing) == []
        assert not local_path_available(missing)

    def test_pattern_with_no_matches_is_unavailable(self, tmp_path: pathlib.Path) -> None:
        pattern = str(tmp_path / "run__1__[shortName].grib2")
        assert _expand_local_path(pattern) == []
        assert not local_path_available(pattern)

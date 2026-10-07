from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from cascade.gateway import api

from forecastbox.domain.run import stop
from forecastbox.domain.run.types import RunId

RUN = RunId("run-1")


def test_stop_cascade_job_sends_single_job_shutdown_with_long_timeout() -> None:
    with (
        patch("forecastbox.domain.run.stop.request_response", return_value=api.ShutdownResponse(error=None)) as rr,
        patch("forecastbox.domain.run.stop.get_gateway_url", return_value="tcp://gw"),
    ):
        stop.stop_cascade_job("job-1")
    request = rr.call_args.args[0]
    assert isinstance(request, api.ShutdownRequest)
    assert request.only_these == ["job-1"]
    assert rr.call_args.args[2] >= 15_000


def test_stop_cascade_and_mark_success_transitions_to_stopped() -> None:
    update = MagicMock(return_value=True)
    with (
        patch.object(stop, "stop_cascade_job", return_value=SimpleNamespace(error=None)),
        patch.object(stop.db, "update_run_runtime", update),
    ):
        stop.stop_cascade_and_mark(RUN, 1, "job-1")
    update.assert_called_once_with(RUN, 1, expected_status="stopping", status="stopped")


def test_stop_cascade_and_mark_error_response_leaves_stopping() -> None:
    update = MagicMock()
    with (
        patch.object(stop, "stop_cascade_job", return_value=SimpleNamespace(error="whatever")),
        patch.object(stop.db, "update_run_runtime", update),
    ):
        stop.stop_cascade_and_mark(RUN, 1, "job-1")
    update.assert_not_called()


def test_stop_cascade_and_mark_exception_leaves_stopping() -> None:
    update = MagicMock()
    with (
        patch.object(stop, "stop_cascade_job", side_effect=TimeoutError()),
        patch.object(stop.db, "update_run_runtime", update),
    ):
        stop.stop_cascade_and_mark(RUN, 1, "job-1")
    update.assert_not_called()

from types import SimpleNamespace
from typing import cast

from cascade.low.core import DatasetId, TaskId
from fiab_core.fable import BlockInstanceId

from forecastbox.domain.run import service
from forecastbox.domain.run.cascade import RunOutputCharacteristic, RunOutputs
from forecastbox.schemata.jobs import Run


def test_get_mime_of_output_returns_declared_mime() -> None:
    execution = cast(
        Run,
        SimpleNamespace(
            run_id="run-1",
            outputs=RunOutputs(
                outputs={
                    TaskId("task-a"): RunOutputCharacteristic(
                        original_block=BlockInstanceId("block-a"),
                        mime_type="text/plain",
                    )
                }
            ).model_dump(),
        ),
    )

    result = service.get_mime_of_output(execution, DatasetId(task=TaskId("task-a"), output="0"))

    assert result.t == "text/plain"
    assert result.e is None


def test_get_mime_of_output_rejects_unknown_task() -> None:
    execution = cast(
        Run,
        SimpleNamespace(
            run_id="run-1",
            outputs=RunOutputs(
                outputs={
                    TaskId("task-a"): RunOutputCharacteristic(
                        original_block=BlockInstanceId("block-a"),
                        mime_type="text/plain",
                    )
                }
            ).model_dump(),
        ),
    )

    result = service.get_mime_of_output(execution, DatasetId(task=TaskId("task-b"), output="0"))

    assert result.t is None
    assert result.e is not None
    assert "not found" in result.e

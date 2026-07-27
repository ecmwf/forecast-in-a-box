import inspect
from collections.abc import Awaitable, Callable

import pytest

from forecastbox.utility.concurrency.manager import execution_manager


@pytest.fixture(autouse=True)
def inline_execution_manager(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _awaitable_submit(pool_name: object, task_name: object, task: Callable[[], object]) -> object:
        result = task()
        if inspect.isawaitable(result):
            return await result
        return result

    def _submit_monitored(pool_name: object, task_name: object, task: Callable[[], object]) -> None:
        result = task()
        if inspect.isawaitable(result):
            raise TypeError(f"unit test inline submit_monitored received awaitable result for {task_name!r}")

    monkeypatch.setattr(execution_manager, "awaitable_submit", _awaitable_submit)
    monkeypatch.setattr(execution_manager, "submit_monitored", _submit_monitored)

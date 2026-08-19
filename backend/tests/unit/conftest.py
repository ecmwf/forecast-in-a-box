import inspect
from collections.abc import Awaitable, Callable
from concurrent.futures import Future
from typing import Any

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

    def _submit_after(
        dependency: "Future[Any]",
        pool_name: object,
        task_name: object,
        task: Callable[[], object],
        *,
        run_if_dependency_failed: bool = False,
    ) -> None:
        """Model both successful and failed dependency futures inline: run ``task``
        synchronously once ``dependency`` is done, unless it failed and
        ``run_if_dependency_failed`` is False.
        """

        def _on_done(done: "Future[Any]") -> None:
            dependency_failed = False
            try:
                done.result()
            except BaseException:
                dependency_failed = True
            if dependency_failed and not run_if_dependency_failed:
                return
            result = task()
            if inspect.isawaitable(result):
                raise TypeError(f"unit test inline submit_after received awaitable result for {task_name!r}")

        if dependency.done():
            _on_done(dependency)
        else:
            dependency.add_done_callback(_on_done)

    monkeypatch.setattr(execution_manager, "awaitable_submit", _awaitable_submit)
    monkeypatch.setattr(execution_manager, "submit_monitored", _submit_monitored)
    monkeypatch.setattr(execution_manager, "submit_after", _submit_after)

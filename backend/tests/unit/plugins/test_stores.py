from unittest.mock import MagicMock, patch

import httpx
import orjson
import pytest
from fiab_core.fable import PluginId

from forecastbox.domain.plugin.store import PluginStore, PluginStoreEntry, StoresManager, fetch_store, get_plugins_detail
from forecastbox.utility.config import ConcurrentPools, PluginStoreConfig


def test_fetch() -> None:
    fake_store = PluginStore(
        display_name="ecmwf",
        plugins={
            PluginId("plugin1"): PluginStoreEntry(
                pip_source="pip_source",
                module_name="module_name",
                display_title="display_title",
                display_description="display_description",
                display_author="display_author",
                comment="comment",
            ),
        },
    )

    store_config = PluginStoreConfig(url="https://example.com", method="file")
    mock_request = httpx.Request("GET", "https://example.com")
    mock_response = httpx.Response(
        status_code=200,
        content=orjson.dumps(fake_store.model_dump()),
        request=mock_request,
    )

    with patch("httpx.Client.get") as mocked_get:
        mocked_get.return_value = mock_response
        with httpx.Client() as client:
            result = fetch_store(client, store_config)

    assert result == fake_store


def test_submit_initialize_stores_submits_one_monitored_io_task(monkeypatch: pytest.MonkeyPatch) -> None:
    """submit_initialize_stores() must submit exactly one monitored task to the shared Io
    pool -- no fallback thread, no blocking for completion."""
    from forecastbox.domain.plugin import store as store_module

    submissions: list[tuple[object, object]] = []

    def _fake_submit_monitored(pool_name: object, task_name: object, task: object) -> None:
        submissions.append((pool_name, task_name))

    monkeypatch.setattr(store_module.execution_manager, "submit_monitored", _fake_submit_monitored)

    store_module.submit_initialize_stores()

    assert len(submissions) == 1
    pool_name, task_name = submissions[0]
    assert pool_name == ConcurrentPools.Io
    assert task_name == "plugin.stores.initialize"


def test_initialize_stores_publishes_only_after_successful_fetch(monkeypatch: pytest.MonkeyPatch) -> None:
    """An exception during fetch/populate must propagate (for monitored-task handling) and
    must not publish a partial store map."""
    from forecastbox.domain.plugin import store as store_module

    monkeypatch.setattr(store_module.StoresManager, "stores", store_module.pmap())

    def _boom(client: httpx.Client, plugin_store_config: object) -> PluginStore:
        raise RuntimeError("network exploded")

    monkeypatch.setattr(store_module, "fetch_store", _boom)

    with pytest.raises(RuntimeError):
        store_module.initialize_stores({"someStore": MagicMock()})

    assert dict(StoresManager.stores) == {}


def test_get_plugins_detail_is_lock_free_over_published_map(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_plugins_detail() must not need StoresManager.stores_lock to read."""
    from forecastbox.domain.plugin.store import PluginRemoteInfo

    fake_store = PluginStore(
        display_name="ecmwf",
        plugins={
            PluginId("plugin1"): PluginStoreEntry(
                pip_source="pip_source",
                module_name="module_name",
                display_title="display_title",
                display_description="display_description",
                display_author="display_author",
            ),
        },
    )
    fake_store.remote[PluginId("plugin1")] = PluginRemoteInfo(version="1.0")

    from forecastbox.domain.plugin import store as store_module

    monkeypatch.setattr(store_module.StoresManager, "stores", store_module.pmap({"ecmwfStore": fake_store}))
    StoresManager.stores_lock.acquire()
    try:
        detail = get_plugins_detail()
    finally:
        StoresManager.stores_lock.release()
    assert len(detail) == 1

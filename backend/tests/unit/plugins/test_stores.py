from unittest.mock import patch

import httpx
import orjson
import pytest

from forecastbox.api.plugin.store import PluginStore, PluginStoreConfig, PluginStoreEntry


def test_fetch():
    fake_store = PluginStore(
        display_name="ecmwf",
        plugins={
            "plugin1": PluginStoreEntry(
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
            result = PluginStore.fetch(client, store_config)

    assert result == fake_store

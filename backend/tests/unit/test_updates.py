import json
import re
import tempfile
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from forecastbox.api.updates import (Release, get_local_release, get_lock_timestamp, get_most_recent_release,
                                     get_pylock, save_pylock)


def test_release_from_string():
    assert Release.from_string("1.2.3") == Release(1, 2, 3)
    assert Release.from_string("v1.2.3") == Release(1, 2, 3)
    assert Release.from_string("d1.2.3") == Release(1, 2, 3)
    assert Release.from_string("10.20.30") == Release(10, 20, 30)

def test_release_from_string_invalid():
    with pytest.raises(ValueError):
        Release.from_string("1.2")
    with pytest.raises(ValueError):
        Release.from_string("1.2.3.4")
    with pytest.raises(ValueError):
        Release.from_string("abc")

@pytest_asyncio.fixture
async def mock_httpx_client():
    with patch("httpx.AsyncClient") as mock_client_class:
        mock_client = AsyncMock()
        mock_client_class.return_value.__aenter__.return_value = mock_client
        yield mock_client

@pytest.mark.asyncio
async def test_get_most_recent_release(mock_httpx_client):
    mock_response_json = '''
    [{
        "url":"https://api.github.com/repos/ecmwf/forecast-in-a-box/releases/257019467",
        "assets_url":"https://api.github.com/repos/ecmwf/forecast-in-a-box/releases/257019467/assets",
        "upload_url":"https://uploads.github.com/repos/ecmwf/forecast-in-a-box/releases/257019467/assets{?name,label}",
        "html_url":"https://github.com/ecmwf/forecast-in-a-box/releases/tag/v0.3.9",
        "id":257019467,
        "author":{"login":"HCookie","id":48088699,"node_id":"MDQ6VXNlcjQ4ODA4ODY5OS","avatar_url":"https://avatars.githubusercontent.com/u/48088699?v=4","gravatar_id":"","url":"https://api.github.com/users/HCookie","html_url":"https://github.com/HCookie","followers_url":"https://api.github.com/users/HCookie/followers","following_url":"https://api.github.com/users/HCookie/following{/other_user}","gists_url":"https://api.github.com/users/HCookie/gists{/gist_id}","starred_url":"https://api.github.com/users/HCookie/starred{/owner}{/repo}","subscriptions_url":"https://api.github.com/users/HCookie/subscriptions","organizations_url":"https://api.github.com/users/HCookie/orgs","repos_url":"https://api.github.com/users/HCookie/repos","events_url":"https://api.github.com/users/HCookie/events{/privacy}","received_events_url":"https://api.github.com/users/HCookie/received_events","type":"User","user_view_type":"public","site_admin":false},
        "node_id":"RE_kwDOL8XCIs4PUc5L","tag_name":"v0.3.9","target_commitish":"main","name":"v0.3.9","draft":false,"immutable":false,"prerelease":false,"created_at":"2025-10-24T14:17:21Z","updated_at":"2025-10-29T13:13:17Z","published_at":"2025-10-24T14:20:16Z","assets":[],"tarball_url":"https://api.github.com/repos/ecmwf/forecast-in-a-box/tarball/v0.3.9","zipball_url":"https://api.github.com/repos/ecmwf/forecast-in-a-box/zipball/v0.3.9","body":"Update taglines"
    }]
    '''
    mock_response_obj = MagicMock()
    mock_response_obj.json.return_value = json.loads(mock_response_json)
    mock_response_obj.raise_for_status.return_value = None
    mock_httpx_client.get.return_value = mock_response_obj
    assert await get_most_recent_release() == Release(0, 3, 9)

@pytest.mark.asyncio
async def test_get_most_recent_release_no_releases(mock_httpx_client):
    mock_response_obj = MagicMock()
    mock_response_obj.json.return_value = []
    mock_response_obj.raise_for_status.return_value = None
    mock_httpx_client.get.return_value = mock_response_obj
    with pytest.raises(ValueError, match="No releases found on GitHub."):
        await get_most_recent_release()

@patch("forecastbox.api.updates.fiab_home", new=Path("/tmp/fiab_test"))
@patch("pathlib.Path.is_file")
@patch("pathlib.Path.read_text")
def test_get_lock_timestamp(mock_read_text, mock_is_file):
    # Test case: file exists and contains content
    mock_is_file.return_value = True
    mock_read_text.return_value = "1761908420:v0.1.0\n"
    assert get_lock_timestamp() == "1761908420:v0.1.0"

    # Test case: file does not exist
    mock_is_file.return_value = False
    assert get_lock_timestamp() == ""

    # Test case: file exists but is empty
    mock_is_file.return_value = True
    mock_read_text.return_value = "\n"
    assert get_lock_timestamp() == ""

@patch("forecastbox.api.updates.get_lock_timestamp")
def test_get_local_release(mock_get_lock_timestamp):
    # Test case: valid timestamp and release string
    mock_get_lock_timestamp.return_value = "1761908420:v0.1.0"
    dt, release = get_local_release()
    assert dt == datetime.fromtimestamp(int("1761908420"))
    assert release == Release(0, 1, 0)

    # Test case: empty file (get_lock_timestamp returns empty string)
    mock_get_lock_timestamp.return_value = ""
    with pytest.raises(ValueError, match="pylock.toml.timestamp file is empty or does not exist."):
        get_local_release()

    # Test case: multiple lines in file
    mock_get_lock_timestamp.return_value = "line1\nline2"
    with pytest.raises(ValueError, match="Invalid format in pylock.toml.timestamp: expected exactly one line."):
        get_local_release()

    # Test case: invalid format (missing colon)
    mock_get_lock_timestamp.return_value = "1761908420_v0.1.0" # No colon at all
    with pytest.raises(ValueError, match="Invalid format in pylock.toml.timestamp: expected 'datetime:release_string'."):
        get_local_release()

    # Test case: invalid release string
    mock_get_lock_timestamp.return_value = "1761908420:invalid_release"
    with pytest.raises(ValueError, match=re.escape("invalid literal for int() with base 10: 'invalid_release'")):
        get_local_release()

@pytest.mark.asyncio
async def test_get_pylock(mock_httpx_client):
    mock_pylock_content = "[tool.uv]\npython = \"3.12\"\n"
    mock_response_obj = MagicMock()
    mock_response_obj.text = mock_pylock_content
    mock_response_obj.raise_for_status.return_value = None
    mock_httpx_client.get.return_value = mock_response_obj

    test_release = Release(1, 2, 3)
    expected_url = "https://github.com/ecmwf/forecast-in-a-box/releases/download/v1.2.3/pylock.toml"

    content = await get_pylock(test_release)

    mock_httpx_client.get.assert_called_once_with(expected_url)
    assert content == mock_pylock_content

@patch("forecastbox.api.updates.fiab_home")
def test_save_pylock(mock_fiab_home):
    with tempfile.TemporaryDirectory() as tmpdir:
        temp_path = Path(tmpdir)

        # Configure the mock_fiab_home to behave like temp_path
        mock_fiab_home.__truediv__.side_effect = lambda x: temp_path / x
        mock_fiab_home.mkdir.side_effect = temp_path.mkdir

        test_pylock_content = "[tool.uv]\npython = \"3.12\"\n"
        test_release = Release(0, 2, 0)

        save_pylock(test_pylock_content, test_release)

        pylock_file = temp_path / "pylock.toml"
        timestamp_file = temp_path / "pylock.toml.timestamp"

        assert pylock_file.is_file()
        assert timestamp_file.is_file()
        assert pylock_file.read_text() == test_pylock_content

        dt, release = get_local_release()
        assert release == test_release
        assert isinstance(dt, datetime)

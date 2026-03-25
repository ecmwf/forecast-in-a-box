# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from unittest.mock import MagicMock, patch

import httpx
import pytest

from forecastbox.ecpyutil import fetch_content


def test_fetch_content_http_success(mocker):
    # Setup mock client
    mock_client = MagicMock(spec=httpx.Client)
    mock_response = MagicMock()
    mock_response.content = b"http content"
    mock_client.get.return_value = mock_response

    # Execute
    result = fetch_content("http://example.com", mock_client)

    # Assert
    assert result == b"http content"
    mock_client.get.assert_called_once_with("http://example.com")
    mock_response.raise_for_status.assert_called_once()


def test_fetch_content_file_success(mocker):
    mock_client = MagicMock(spec=httpx.Client)

    # Mocking Path.read_bytes to avoid actual disk access
    with patch("pathlib.Path.read_bytes") as mock_read:
        mock_read.return_value = b"file content"

        # Execute
        result = fetch_content("file:///tmp/test.txt", mock_client)

        # Assert
        assert result == b"file content"
        mock_read.assert_called_once()


def test_fetch_content_unsupported_protocol():
    mock_client = MagicMock(spec=httpx.Client)
    with pytest.raises(ValueError, match="Unsupported protocol"):
        fetch_content("ftp://invalid.com", mock_client)

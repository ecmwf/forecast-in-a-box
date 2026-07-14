# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import re
from pathlib import Path

import httpx


def fetch_content(url: str, client: httpx.Client) -> bytes:
    """
    Fetches content from a URL. Supports http/https via httpx.Client and local file system via file:// protocol.
    """
    if url.startswith("http://") or url.startswith("https://"):
        response = client.get(url)
        response.raise_for_status()
        return response.content

    elif url.startswith("file://"):
        # Remove the file:// prefix and convert to a Path object
        file_path = Path(url.replace("file://", ""))
        return file_path.read_bytes()

    else:
        raise ValueError("Unsupported protocol. Use http://, https://, or file://")


_CHARSET_RE = re.compile(r"charset=([^\s;]+)", re.IGNORECASE)


def get_encoding(mime_type: str) -> str:
    m = _CHARSET_RE.search(mime_type)
    return m.group(1) if m else "utf-8"

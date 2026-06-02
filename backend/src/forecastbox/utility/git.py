# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Helpers for reading repository tags from GitHub."""

import re
from collections.abc import Iterator

import httpx

_GITHUB_OWNER = "ecmwf"
_GITHUB_REPO = "forecast-in-a-box"
_TAG_RE = re.compile(r"^c(?P<major>\d+)\.(?P<minor>\d+)\.(?P<patch>\d+)(?:\.(?P<build>\d+))?$")


def get_all_repo_tags(client: httpx.Client) -> Iterator[str]:
    """Yield all repository tags from the GitHub API."""
    page = 1
    while True:
        response = client.get(
            f"https://api.github.com/repos/{_GITHUB_OWNER}/{_GITHUB_REPO}/tags",
            params={"per_page": 100, "page": page},
        )
        response.raise_for_status()
        payload = response.json()
        if not payload:
            return
        for tag_data in payload:
            yield tag_data["name"]
        page += 1


def get_highest_tag(tags: Iterator[str]) -> str:
    """Return the highest semantic c-tag from an iterator."""
    best_tag: str | None = None
    best_key: tuple[int, int, int, int] | None = None
    for tag in tags:
        match = _TAG_RE.fullmatch(tag)
        if match is None:
            continue
        major = int(match.group("major") or 0)
        minor = int(match.group("minor") or 0)
        patch = int(match.group("patch") or 0)
        build = int(match.group("build") or 0)
        key = (major, minor, patch, build)
        if best_key is None or key > best_key:
            best_key = key
            best_tag = tag
    if best_tag is None:
        raise ValueError("No c-tags found")
    return best_tag

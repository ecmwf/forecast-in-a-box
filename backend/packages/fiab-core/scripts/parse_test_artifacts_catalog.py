#!/usr/bin/env python3
#
# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Checks on the shipped artifacts catalog (``install/artifacts.json``).

The url check talks to the artifact store, but only via HEAD -- no checkpoint is downloaded, so it
costs a handful of round trips and runs by default."""

import os
import urllib.error
import urllib.request
from collections.abc import Iterator, Sequence
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fiab_core.artifacts import ArtifactStoreId, CommonArtifactMetadata, parse_json

REQUEST_TIMEOUT_S = 15
# a store outage looks the same as an offline laptop, so one retry before we conclude unreachable
REQUEST_ATTEMPTS = 2

# (status, content_length) on an http response, or (None, reason) if the store could not be reached
HeadResult = tuple[int | None, int | str | None]

Artifacts = list[tuple[str, CommonArtifactMetadata]]


def read_and_parse(pth: Path) -> Artifacts:
    if not pth.is_file():
        raise ValueError(f"catalog not present at {pth} -- running outside a source checkout")
    parsed = parse_json(ArtifactStoreId("validation"), pth.read_text(), lambda _common, _specific: (True, None))
    return [(composite_id.artifact_local_id, resolved.common) for composite_id, resolved in parsed]


def _head(url: str) -> HeadResult:
    """HEAD `url`, following redirects. Downloads no body -- the size comes from Content-Length."""
    request = urllib.request.Request(url, method="HEAD")
    reason = "unknown"
    for _ in range(REQUEST_ATTEMPTS):
        try:
            with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_S) as response:
                raw_length = response.headers.get("Content-Length")
                return response.status, int(raw_length) if raw_length is not None else None
        except urllib.error.HTTPError as e:
            # the store answered, it just does not have this url -- a real finding, not a retry
            return e.code, None
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            reason = str(e)
    return None, reason


def validate_catalog_urls(artifacts: Artifacts) -> None:
    """Every catalog url must resolve, and disk_size_bytes must match the actual download size.

    Guards against the two ways the catalog silently rots: a checkpoint being moved or renamed in
    the artifact store, and a disk_size_bytes copy-pasted from a sibling entry (it is display-only,
    so a wrong value is invisible until a user reads it).
    """

    # several entries legitimately share one checkpoint (eg the aarch64 variant), so fetch each url once
    by_url: dict[str, list[str]] = {}
    for local_id, common in artifacts:
        by_url.setdefault(common.url, []).append(local_id)

    urls = sorted(by_url)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results: dict[str, HeadResult] = dict(zip(urls, pool.map(_head, urls)))

    unreachable = [f"{url}: {reason}" for url, (status, reason) in results.items() if status is None]
    if unreachable:
        message = "could not reach the artifact store:\n" + "\n".join(unreachable)
        raise ValueError(message)

    def problems() -> Iterator[str]:
        for url in urls:
            status, _ = results[url]
            if status != 200:
                yield f"{', '.join(sorted(by_url[url]))}: HTTP {status} for {url}"
        # sizes are per entry, not per url -- entries sharing a url must each declare it correctly
        for local_id, common in sorted(artifacts, key=lambda entry: entry[0]):
            status, content_length = results[common.url]
            if status == 200 and content_length is not None and content_length != common.disk_size_bytes:
                yield f"{local_id}: disk_size_bytes is {common.disk_size_bytes} but {common.url} is {content_length} bytes"

    found = list(problems())
    if found:
        message = "artifacts catalog is out of sync with the artifact store:\n" + "\n".join(found)
        raise ValueError(message)


def main(argv: Sequence[str] | None = None) -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    args = parser.parse_args(argv)
    pth = args.path

    # 1. read and parse
    artifacts = read_and_parse(pth)

    # 2. validate individual urls
    validate_catalog_urls(artifacts)


if __name__ == "__main__":
    main()

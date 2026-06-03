# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Artifact catalog: loading and querying available artifacts from remote stores."""

from collections.abc import Iterator

import httpx
from cascade.low.func import assert_never
from fiab_core.artifacts import ArtifactResolved, CompositeArtifactId, parse_json
from pyrsistent import pmap

from forecastbox.domain.artifact.base import ArtifactCatalog
from forecastbox.domain.artifact.compatibility import get_model_checkpoint_compatibility, get_platform_info
from forecastbox.utility.config import ArtifactStoresConfig
from forecastbox.utility.git import get_all_repo_tags, get_highest_tag
from forecastbox.utility.httpx import fetch_content


def _tagged_url(url: str, tag: str) -> str:
    return url.replace("${TAG}", tag)


def _iter_artifacts(
    artifact_stores_config: ArtifactStoresConfig,
    client: httpx.Client,
) -> Iterator[tuple[CompositeArtifactId, ArtifactResolved]]:
    platform_info = get_platform_info()
    for store_id, store_config in artifact_stores_config.items():
        if store_config.method == "file":
            raw = fetch_content(store_config.url, client).decode("utf-8")
        elif store_config.method == "gittag":
            tag = get_highest_tag(tag for tag in get_all_repo_tags(client) if tag.startswith("c"))
            raw = fetch_content(_tagged_url(store_config.url, tag), client).decode("utf-8")
        else:
            assert_never(store_config.method)

        yield from parse_json(
            store_id,
            raw,
            lambda store_info: get_model_checkpoint_compatibility(store_info, platform_info),
        )


def get_artifacts_catalog(artifact_stores_config: ArtifactStoresConfig) -> ArtifactCatalog:
    """Query each artifact store and return a composed catalog of all available artifacts."""
    with httpx.Client(follow_redirects=True) as client:
        return pmap(_iter_artifacts(artifact_stores_config, client))

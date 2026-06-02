# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Artifact catalog: loading and querying available artifacts from remote stores."""

import logging
from urllib.parse import urlparse, urlunparse

import httpx
from cascade.low.func import assert_never
from fiab_core.artifacts import parse_json
from pyrsistent import pmap

from forecastbox.domain.artifact.base import ArtifactCatalog
from forecastbox.domain.artifact.compatibility import get_model_checkpoint_compatibility, get_platform_info
from forecastbox.utility.config import ArtifactStoresConfig
from forecastbox.utility.git import get_all_repo_tags, get_highest_tag
from forecastbox.utility.httpx import fetch_content

logger = logging.getLogger(__name__)


def _tagged_url(url: str, tag: str) -> str:
    parsed = urlparse(url)
    parts = parsed.path.split("/")
    for index in range(len(parts) - 2):
        if parts[index] == "refs" and parts[index + 1] == "heads":
            parts[index + 1] = "tags"
            parts[index + 2] = tag
            return urlunparse(parsed._replace(path="/".join(parts)))
    raise ValueError(f"Cannot derive tagged URL from {url}")


def get_artifacts_catalog(artifact_stores_config: ArtifactStoresConfig) -> ArtifactCatalog:
    """Query each artifact store and return a composed catalog of all available artifacts."""
    catalog = {}
    platform_info = get_platform_info()

    with httpx.Client(follow_redirects=True) as client:
        for store_id, store_config in artifact_stores_config.items():
            if store_config.method == "file":
                raw = fetch_content(store_config.url, client).decode("utf-8")
            elif store_config.method == "gittag":
                tag = get_highest_tag(tag for tag in get_all_repo_tags(client) if tag.startswith("c"))
                raw = fetch_content(_tagged_url(store_config.url, tag), client).decode("utf-8")
            else:
                assert_never(store_config.method)

            for composite_id, artifact in parse_json(
                store_id,
                raw,
                lambda store_info: get_model_checkpoint_compatibility(store_info, platform_info),
            ):
                catalog[composite_id] = artifact
                logger.debug(f"Loaded artifact {composite_id} from store {store_id}")

    return pmap(catalog)

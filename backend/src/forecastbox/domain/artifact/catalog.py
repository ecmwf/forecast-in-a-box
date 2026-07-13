# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Artifact catalog: loading and querying available artifacts from remote stores."""

import importlib.metadata
import logging
from collections.abc import Iterator
from itertools import chain

import httpx
from cascade.low.func import assert_never
from fiab_core.artifacts import ArtifactResolved, CompositeArtifactId, parse_json
from pyrsistent import pmap

from forecastbox.domain.artifact.base import ArtifactCatalog
from forecastbox.domain.artifact.compatibility import get_model_checkpoint_compatibility, get_platform_info
from forecastbox.utility.config import ArtifactStoresConfig
from forecastbox.utility.git import get_all_repo_tags, get_highest_tag
from forecastbox.utility.httpx import fetch_content

logger = logging.getLogger(__name__)


def get_artifacts_catalog(artifact_stores_config: ArtifactStoresConfig) -> ArtifactCatalog:
    """Query each artifact store and return a composed catalog of all available artifacts."""
    artifacts_iter = iter(())
    with httpx.Client(follow_redirects=True) as client:
        platform_info = get_platform_info()
        for store_id, store_config in artifact_stores_config.items():
            if store_config.method == "file":
                raw = fetch_content(store_config.url, client).decode("utf-8")
            elif store_config.method == "gittag":
                core_version = importlib.metadata.version("fiab-core")
                if core_version == "0.0.0":
                    logger.debug("fiab-core is 0.0.0, assuming development environment and picking highest tag for artifact catalog fetch")
                    tag_prefix = "c"
                else:
                    logger.debug(f"considering fiab-core's version {core_version} for artifact catalog fetch")
                    tag_prefix = f"c{core_version}"
                actual_tag = get_highest_tag(tag for tag in get_all_repo_tags(client) if tag.startswith(tag_prefix))

                logger.debug(f"going with tag {actual_tag} for artifact catalog fetch")
                resolved_url = store_config.url.replace("${TAG}", actual_tag)
                raw = fetch_content(resolved_url, client).decode("utf-8")
            else:
                assert_never(store_config.method)

            artifacts_iter = chain(
                artifacts_iter,
                parse_json(
                    store_id,
                    raw,
                    lambda common, specific: get_model_checkpoint_compatibility(common, specific, platform_info),
                ),
            )

    return pmap(artifacts_iter)

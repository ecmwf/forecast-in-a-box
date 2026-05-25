# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Artifact catalog: loading and querying available artifacts from remote stores."""

import json
import logging
from typing import cast

import httpx
from cascade.low.func import assert_never
from fiab_core.artifacts import ArtifactLocalId, ArtifactResolved, ArtifactStoreId, ArtifactType, MlModelCheckpoint
from pyrsistent import pmap

from forecastbox.domain.artifact.base import ArtifactCatalog, CompositeArtifactId
from forecastbox.domain.artifact.compatibility import get_model_checkpoint_compatibility, get_platform_info
from forecastbox.utility.config import ArtifactStoresConfig
from forecastbox.utility.httpx import fetch_content

logger = logging.getLogger(__name__)


def get_artifacts_catalog(artifact_stores_config: ArtifactStoresConfig) -> ArtifactCatalog:
    """Query each artifact store and return a composed catalog of all available artifacts."""
    catalog = {}
    platform_info = get_platform_info()

    with httpx.Client(follow_redirects=True) as client:
        for store_id, store_config in artifact_stores_config.items():
            if store_config.method == "file":
                raw = fetch_content(store_config.url, client)
                store_data = json.loads(raw)
                artifacts = store_data.get("artifacts", {})
                for artifact_id, artifact_data in artifacts.items():
                    composite_id = CompositeArtifactId(artifact_store_id=store_id, artifact_local_id=ArtifactLocalId(artifact_id))
                    artifact_type = cast(ArtifactType, artifact_data["artifact_type"])
                    store_info_data = artifact_data["store_info"]
                    if artifact_type == "MlModelCheckpoint":
                        store_info = MlModelCheckpoint(**store_info_data)
                        is_locally_compatible, local_compatibility_detail = get_model_checkpoint_compatibility(store_info, platform_info)
                    else:
                        assert_never(artifact_type)

                    catalog[composite_id] = ArtifactResolved(
                        artifact_type=artifact_type,
                        store_info=store_info,
                        is_locally_compatible=is_locally_compatible,
                        local_compatibility_detail=local_compatibility_detail,
                    )
                    logger.debug(f"Loaded artifact {composite_id} from store {store_id}")
            else:
                assert_never(store_config.method)

    return pmap(catalog)

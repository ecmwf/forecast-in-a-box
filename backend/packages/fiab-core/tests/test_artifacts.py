# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import json

from fiab_core.artifacts import AnemoiCheckpoint, ArtifactLocalId, ArtifactStoreId, CompositeArtifactId, parse_json


def test_parse_json() -> None:
    payload = {
        "display_name": "Store",
        "artifacts": {
            "model1": {
                "artifact_type": "AnemoiCheckpoint",
                "store_info": {
                    "url": "https://example.com/model1.ckpt",
                    "display_name": "Model 1",
                    "display_author": "ECMWF",
                    "display_description": "Example model",
                    "disk_size_bytes": 1,
                    "pip_package_constraints": [],
                    "supported_platforms": ["linux"],
                    "input_characteristics": [],
                    "input_qube": {},
                    "output_qube": {},
                    "timestep": "1h",
                },
            }
        },
    }

    parsed = dict(parse_json(ArtifactStoreId("store1"), json.dumps(payload), lambda checkpoint: (True, checkpoint.display_name)))

    composite_id = CompositeArtifactId(artifact_store_id=ArtifactStoreId("store1"), artifact_local_id=ArtifactLocalId("model1"))
    artifact = parsed[composite_id]

    assert isinstance(artifact.store_info, AnemoiCheckpoint)
    assert artifact.store_info.display_name == "Model 1"
    assert artifact.is_locally_compatible is True
    assert artifact.local_compatibility_detail == "Model 1"

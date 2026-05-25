# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Base definitions pertaining to artifacts such as ml model checkpoints
"""

import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fiab_core.artifacts import ArtifactResolved, CompositeArtifactId, Platform
from pyrsistent.typing import PMap


@dataclass(frozen=True, eq=True, slots=True)
class MlModelOverview:
    """Overview information for listing ML models"""

    composite_id: CompositeArtifactId
    display_name: str
    display_author: str
    disk_size_bytes: int
    supported_platforms: list[Platform]
    is_available: bool
    is_locally_compatible: bool
    local_compatibility_detail: str | None


@dataclass(frozen=True, eq=True, slots=True)
class MlModelDetail:
    """Detailed information for a specific ML model"""

    composite_id: CompositeArtifactId
    display_name: str
    display_author: str
    display_description: str
    url: str
    disk_size_bytes: int
    pip_package_constraints: list[str]
    supported_platforms: list[Platform]
    output_characteristics: dict[str, Any]
    input_characteristics: list[str]
    is_available: bool
    is_locally_compatible: bool
    local_compatibility_detail: str | None


ArtifactCatalog = PMap[CompositeArtifactId, ArtifactResolved]

artifacts_subdir = "artifacts"


def get_artifact_local_path(composite_id: CompositeArtifactId, data_dir_url: str | Path) -> Path:
    """Get the local filesystem path for an artifact file.

    data_dir_url can be:
    - A Path object (legacy, treated as-is)
    - A file:// URL (parsed to extract the path)
    - A plain path string without scheme (treated as file://)

    Raises ValueError if the composite ID contains invalid path characters.
    The returned Path is not checked for existence, only for validity.
    """
    store_id = composite_id.artifact_store_id
    artifact_local_id = composite_id.artifact_local_id

    invalid_chars = {"..", "/", "\\", "\0"}
    if any(char in store_id for char in invalid_chars) or any(char in artifact_local_id for char in invalid_chars):
        raise ValueError(f"Invalid characters in artifact ID: {composite_id}")

    if isinstance(data_dir_url, Path):
        data_dir = data_dir_url
    else:
        data_dir_str = str(data_dir_url)
        if "://" not in data_dir_str:
            data_dir = Path(data_dir_str)
        else:
            parsed = urllib.parse.urlparse(data_dir_str)
            data_dir = Path(parsed.path)

    artifact_path = data_dir / artifacts_subdir / store_id / artifact_local_id

    return artifact_path

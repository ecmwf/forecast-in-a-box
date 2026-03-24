# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Runtime provider singletons for functions implemented by the forecastbox host application.

Plugins that depend only on fiab-core use these providers to call back into host functionality
without creating a hard dependency on the forecastbox package.  The host registers concrete
implementations once at startup, before any plugin code is loaded.
"""

from collections.abc import Callable
from pathlib import Path

from fiab_core.artifacts import CheckpointLookup, CompositeArtifactId


class ArtifactsProvider:
    """Singleton provider giving plugins access to artifact management functions.

    The host application registers implementations via `register_*` class methods
    during startup.  Plugins call the plain class methods to invoke them.
    Raises RuntimeError if a method is called before its implementation is registered.
    """

    _get_checkpoint_lookup: Callable[[], CheckpointLookup] | None = None
    _get_artifact_local_path: Callable[[CompositeArtifactId], Path] | None = None

    @classmethod
    def register_get_checkpoint_lookup(cls, fn: Callable[[], CheckpointLookup]) -> None:
        """Register the get_checkpoint_lookup implementation."""
        cls._get_checkpoint_lookup = fn

    @classmethod
    def get_checkpoint_lookup(cls) -> CheckpointLookup:
        """Return a mapping of all known CompositeArtifactId to MlModelCheckpoint."""
        if cls._get_checkpoint_lookup is None:
            raise RuntimeError("ArtifactsProvider.get_checkpoint_lookup has not been registered")
        return cls._get_checkpoint_lookup()

    @classmethod
    def register_get_artifact_local_path(cls, fn: Callable[[CompositeArtifactId], Path]) -> None:
        """Register the get_artifact_local_path implementation (without data_dir — it is bound at registration time)."""
        cls._get_artifact_local_path = fn

    @classmethod
    def get_artifact_local_path(cls, composite_id: CompositeArtifactId) -> Path:
        """Return the local filesystem path for the given artifact."""
        if cls._get_artifact_local_path is None:
            raise RuntimeError("ArtifactsProvider.get_artifact_local_path has not been registered")
        return cls._get_artifact_local_path(composite_id)

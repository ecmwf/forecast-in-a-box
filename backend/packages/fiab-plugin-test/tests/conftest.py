from unittest.mock import MagicMock

import pytest
from fiab_core.artifacts import ArtifactsProvider, CompositeArtifactId


@pytest.fixture(scope="session", autouse=True)
def register_artifacts_provider() -> None:
    fake_id = CompositeArtifactId.from_str("mystore:mycheckpoint")
    ArtifactsProvider.register_get_checkpoint_lookup(lambda: {fake_id: MagicMock()})

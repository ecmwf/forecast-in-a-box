import pytest
from fiab_core.artifacts import ArtifactResolved, ArtifactsProvider, CompositeArtifactId, MlModelCheckpoint


@pytest.fixture(scope="session", autouse=True)
def register_artifacts_provider() -> None:
    fake_id = CompositeArtifactId.from_str("mystore:mycheckpoint")
    ArtifactsProvider.register_get_artifacts_lookup(
        lambda: {
            fake_id: ArtifactResolved(
                artifact_type="MlModelCheckpoint",
                store_info=MlModelCheckpoint(
                    url="http://example.com/fake_checkpoint",
                    display_name="Fake Checkpoint",
                    display_author="Test Author",
                    display_description="A fake checkpoint for testing",
                    disk_size_bytes=0,
                    pip_package_constraints=[],
                    supported_platforms=[],
                    input_characteristics=[],
                    output_qube={},
                    timestep="1h",
                    comment="",
                ),
                is_locally_compatible=True,
                local_compatibility_detail=None,
            )
        }
    )

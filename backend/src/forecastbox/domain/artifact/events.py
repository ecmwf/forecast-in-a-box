# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Events emitted by the Artifact domain.

Currently only the completion of an artifact download is surfaced to clients.
Progress reports are intentionally not surfaced this way, clients are expected to poll for those.
Artifact deletion or registry fetch both happen in a blocking manner, thus no need for notification.
"""

from dataclasses import dataclass

from forecastbox.domain.artifact.base import CompositeArtifactId
from forecastbox.domain.notification.models import ClientNotification


@dataclass(frozen=True, eq=True, slots=True)
class ArtifactDownloadFinishedEvent:
    """Emitted once an artifact download completes and the artifact becomes locally available."""

    composite_id: CompositeArtifactId
    is_success: bool

    def as_client_notification(self) -> ClientNotification:
        result = ("un" if not self.is_success else "") + "successfully"
        return ClientNotification(
            text=f"Artifact {self.composite_id.artifact_local_id} finished downloading {result}",
            sourceDomainName="artifact",
            sourceDomainEvent="artifactDownloadFinished",
            context={
                "artifact_store_id": self.composite_id.artifact_store_id,
                "artifact_local_id": self.composite_id.artifact_local_id,
                "success": self.is_success,
            },
            detailRoute="api/v1/artifacts/model_details",
            refreshRoutes=["api/v1/artifacts/list_models"],
        )

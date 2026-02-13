# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Downloading and managing artifacts such as ml model checkpoints
"""

"""
To be implemented (consult forecastbox.config, fiab_core.artifacts for the classes refered to below)

new classes/aliases
CompositeArtifactId -- a dataclass of ArtifactStoreId, MlModelCheckpointId
ArtifactCatalog = dict[CompositeArtifactId, MlModelCheckpoint]

1. get_artifacts_catalog(ArtifactStoresConfig) -> ArtifactCatalog
queries each artifact store individually, returns the composed dictionary

3. list_local_storage(artifactsCatalog, data_dir) -> list[CompositeArtifactId]
we will store things under datadir (typically this would come from fiab.config), subdir artifacts, further organized by artifact store id, ml model checkpoint id
this method simply traverses this tree, and cross-checking the artifactsCatalog, ie, if it finds a folder at the artifact store id level which is not in catalog, it logs a warning but does not go inside

4. get_artifact_local_path(CompositeArtifactId, data_dir) -> pathlib.Path
full path corresponding to the artifact id. The artifact does not need to exist!
the CompositeArtifactId can contain arbitrary strings, which may not give a valid path -- check for it and raise in this case

5. download_artifact(CompositeArtifactId, ArtifactsCatalog, data_dir) -> None
downloads the artifact at the given url
the implementation should be kinda the same as in download_file in api.routers.model,
except that it will be sync, not async, we will not report progress yet (ie leave at the right place # TODO report progress)

For each method implement a unit test in tests/unit/test_artifacts
Use tmpdir as the artifact directory
Mock the httpx client for the download artifact
"""

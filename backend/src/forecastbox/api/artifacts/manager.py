# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


"""
TODO -- this module contains functions to download artifact catalogs as well as individual artifacts.
What remains is to invoke these functions. Inspect forecastbox/api/plugin/manager for a rough idea of what we need to do

1/ Create an ArtifactManager class, with a lock, a thread|None (or a thread pool with size 1, that may be easier), a catalog, and locally_available: set[CompositeArtifactId]
2/ Implement a `submit_refresh_catalog` which would submit the get_catalog and list_local methods from artifacts.io to the thread/pool. Note you need a wrapper method which safely with a lock replaces each result in the catalog, thats what should be the thread's target
3/ Implement a join_manager method which just joins the thread/pool
4/ Invoke this submit and join methods in the forecastbox.entrypoint, like the others are
5/ Implement two methods list_models and get_model_details, where both lock and return a projection of the catalog
  - list_models returns a list of (display_name, display_author, disk_size_bytes, disk_supported_platforms, is_available)
  - get_model_details returns the whole MlModelCheckpoint except the comment field plus the is_available
  - for both of the return objects define a new dataclass: MlModelOverview and MlModelDetail, in the artifacts.base
6/ Introduce api.routers.artifacts, and register it in forecastbox.entrypoint. Implement endpoints: list_models (path "list_models", no params) and get_model_details (path "model_details", body param composite model id), which invoke the respective manager methods and return the respective dataclasses.
7/ Implement submit_artifact_download in manager and a corresponding router method download_model ("download_model", body param composite model id)

note that with a single thread / threadpool of size 1, we are limited to one io operation at a time. This is ok, we will improve this in a later request

dont worry about tests here for now, we will introduce an integration test later. Just make sure the type check passes
"""

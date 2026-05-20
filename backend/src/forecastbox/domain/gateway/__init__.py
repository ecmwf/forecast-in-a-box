# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Manages the Gateway domain -- process lifecycle and connection URL used by
other domains to execute and inspect workflow jobs.

Depends on utility config and Cascade runtime bindings.
Depended on by Run domain and gateway/status routes.
"""

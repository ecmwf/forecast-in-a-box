# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Aliases for environmental dependencies"""

# NOTE caveat: do *not* use earthkit-workflows or orjson or cloudpickle
# here; basically everything that cascade imports during start -- those cannot be
# modified at runtime (until we rewrite cascade from python to rust).
# NOTE caveat: do *not* use earthkit-data[something], there is some behaviour oddity
# either on pip or on our side, which makes it do nothing

mars_dependencies = ["ecmwf-api-client>=1.6.5"]  # effective for earthkit-data[mars]
opendata_dependencies = ["ecmwf-opendata>=0.3.31"]  # effective for earthkit-data[opendata]

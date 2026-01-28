# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from fiab_core.tools.blocks import FableImplementation
from fiab_core.tools.factory import PluginFactory

from fiab_plugin_ecmwf.blocks import EkdSource, EnsembleStatistics, TemporalStatistics, ZarrSink

implementations: dict[str, FableImplementation] = {
    "ekdSource": EkdSource(),
    "ensembleStatistics": EnsembleStatistics(),
    "temporalStatistics": TemporalStatistics(),
    "zarrSink": ZarrSink(),
}

plugin = PluginFactory(implementations=implementations).as_plugin()

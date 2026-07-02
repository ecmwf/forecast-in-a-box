# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Structured error types for plugin lifecycle events.

A ``PluginError`` captures one diagnostic item produced during the plugin
lifecycle. A plugin may accumulate multiple errors and/or warnings across
different lifecycle phases.

Lifecycle sources:
- ``install`` -- pip install phase; failure here means the package could not be
  installed at all.
- ``load`` -- importlib / Plugin() instantiation phase; failure here means the
  package is installed but the plugin object cannot be constructed.
- ``template_ingest`` -- blueprint template validation and DB upsert phase;
  errors here are per-template and do not prevent the plugin from being used for
  other templates.

Severities:
- ``warning`` -- the plugin still loads and operates; e.g. version mismatch
  between DB record and installed package, or a single template failing
  validation.
- ``error`` -- the plugin cannot be used; e.g. install failure or import
  failure.
- ``critical`` -- reserved for conditions that would cause the whole backend to
  shut down; none exist at the time of writing.
"""

from typing import Literal

from forecastbox.utility.pydantic import FiabBaseModel


class PluginError(FiabBaseModel):
    source: Literal["install", "load", "template_ingest"]
    detail: str
    severity: Literal["warning", "error", "critical"]


PluginErrors = list[PluginError]

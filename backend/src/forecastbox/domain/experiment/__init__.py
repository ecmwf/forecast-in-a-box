# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Manages Experiment domain -- an Experiment is a collection of Runs, possibly growing
over time (such as when the Experiment is a regular cron-based schedule).

An Experiment is either a cron-based schedule (the `scheduling` subpackage), or an event trigger
of type `external_trigger` (the `triggers` subpackage). An event trigger submits a Run of its
Blueprint for each matching Aviso event, passing the event fields to the Run as Glyphs. The
`triggers` subpackage holds the trigger specification and event-to-glyph mapping (`spec`), the
database helpers and the table of handled events (`db`), the service with the event handling
(`service`), and the listener thread (`listener`). The service and the routes reach the listener
only through the `control` module, which the listener registers into, so they do not import it.
The listener is created and registered with the execution manager by the entrypoint, only when
`aviso.enabled` is set, which keeps this domain independent of the entrypoint.

Depends on the Blueprint domain (each Experiment has one associated Blueprint).
Depends on the Run domain (Experiments spawn the associated Runs which then persist the association).
Depends on the Glyph domain (Experiments need to utilize Glyphs for scheduling, and the event
triggers use it to validate the names of the Glyphs they set).
Depended on no other domain.
"""

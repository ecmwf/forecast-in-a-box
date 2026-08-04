# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Manages the Notification domain -- delivering ClientNotification messages to connected
websocket clients.

This domain depends on no other domain. Any other domain may depend on it: a domain that wants
to notify clients declares an event in its own ``events.py`` implementing the
``ClientNotificationSource`` protocol from ``domain.notification.models`` and emits it through the
process-local event dispatcher (``utility.dispatcher``). This domain's ``dispatchers.py`` registers
a single handler, matched on the ``ClientNotificationSource`` protocol, which converts the event
payload into a ``ClientNotification`` and forwards it to the ``NotificationBroadcaster`` for
delivery to connected websocket clients (see `routes/notification.py`).
"""

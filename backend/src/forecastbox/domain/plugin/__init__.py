"""
Manages Plugin domain -- python packages (wheels) that expose a concrete interface used for Blueprint
building and validation, and Run execution.

Now also owns persisted install state: each configured plugin's install outcome (version, timestamp,
install error) is recorded in the ``plugin_state`` DB table via ``domain/plugin/db.py``.

Depends on the Notification domain for event contracts.
Depended on by Blueprint and Run domains -- they need to extract individual plugin validations and compilers, and to validate fiab-core version.

Loosely coupled to Blueprint: emits `PluginTemplatesChangedEvent`/`PluginTemplatesRemovedEvent` (see
`events.py`), handled by `domain/blueprint/dispatchers.py`; the plugin domain never imports blueprint.
`service.py` is the entry point other domains (blueprint) use for template ingestion data, and
`notifications.py` holds the client notification helpers for managed operations.
"""

"""
Manages Plugin domain -- python packages (wheels) that expose a concrete interface used for Blueprint
building and validation, and Run execution.

Now also owns persisted install state: each configured plugin's install outcome (version, timestamp,
install error) is recorded in the ``plugin_state`` DB table via ``domain/plugin/db.py``.

Depends on the Notification domain for event contracts.
Depended on by Blueprint and Run domains -- they need to extract individual plugin validations and compilers, and to validate fiab-core version.

Loosely coupled to Blueprint domain -- template ingestion/removal is delegated to hooks injected by the entrypoint (see
``template_hooks.py``), implemented by the Blueprint domain.
"""

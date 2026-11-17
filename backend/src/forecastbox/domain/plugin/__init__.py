"""
Manages Plugin domain -- python packages (wheels) that expose a concrete interface used for Blueprint
building and validation, and Run execution.

Now also owns persisted install state: each configured plugin's install outcome (version, timestamp,
install error) is recorded in the ``plugin_state`` DB table via ``domain/plugin/db.py``.

Depends on the Notification domain for event contracts.
Depended on by Blueprint and Run domains -- they need to extract individual plugin validations and compilers, and to validate fiab-core version.

Loosely coupled to Plugin domain -- emits template events which are then consumed by it.
"""

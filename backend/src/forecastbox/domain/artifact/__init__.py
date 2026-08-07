"""
Manages the Artifact domain -- downloadable model checkpoints and other large binary data objects utilized by Runs.

Does not depend on any other domain directly. Loosely coupled with the Notification domain: once an
artifact download completes, `manager.py` emits an `ArtifactDownloadedEvent` (see `events.py`) through
the process-local event dispatcher, which the Notification domain picks up and forwards to connected
websocket clients.

Depended on by Run domain.
"""

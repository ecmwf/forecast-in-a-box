# Useful Recipes and HowTos
## Configuration
See the config.py in backend for overview of whats possible.
You can either modify your config toml file in your `FIAB_ROOT` (typically `~/.fiab`), or export them as environment variables (e.g. `fiab__auth__passthrough=True` for setting the `auth.passthrough` config value).

Also see the fiab.sh for environment variables which modify the package behaviour (like the already mentioned fiab root).

## How to get logs
Often you get `TaskFailure(detail="something went wrong but there are no details", worker="h0.w1")` in the logs, but not the stack trace itself.
This is because executor logs don't go to the stdout generally -- only the fiab server logs end up there.
To get the full stacktrace and full history, you can either:
1. call the logs endpoint, `api/v1/gateway/logs`, which will return you a zip file with all the log files (this is useful for pair debugging),
2. pick the logs from the file system -- the gateway logs at the start a line like `logging base is at {Globals.logs_directory.name}` which tells you where the folder with all logs is located (most likely something like `/tmp/fiabLogs<something>`, you can also just ls and pick by date),
3. export `FIAB_LOGSTDOUT=yea` before you start your fiab process -- then you will not get logging into the files, but everything will be in the standout.

Keep in mind there is a lot of logs, which makes the third option at times unpractical. The file-based logging separates logs from controller, gateway, executors, etc. In this example we would find the stacktrace in the file with `h0.w1` in name, though in some cases logs of the controller or other workers may be relevant as well.

## Event triggers (Aviso)
An experiment of type `external_trigger` (an event trigger) submits a run of its blueprint for every matching event of an [Aviso](https://github.com/ecmwf/aviso-client) server.
The users manage triggers via the REST API, see the [user guide](../userGuide.md#event-triggers).
The listener which receives the events is a background thread of the backend, and is off by default.

### Enabling
Set `fiab__aviso__enabled=true` in the environment, or `enabled = true` in the `[aviso]` section of the config toml.
With the setting off, the thread is not started, `pyaviso` is not imported, and the trigger routes still work (a trigger can be created and fired manually, but receives no events).

| Setting (env variable) | Default | Meaning |
| --- | --- | --- |
| `fiab__aviso__enabled` | `false` | Start the Aviso listener thread. |
| `fiab__aviso__base_url` | unset | Base URL of the Aviso server. When unset, `pyaviso` resolves it itself, see below. |
| `fiab__aviso__reconnect_backoff_seconds` | `30` | Wait between a failed listen connection and the next attempt. Must be positive. |

### Installing the client
The listener needs the `pyaviso` package, version 2.4 or newer (the 1.x releases of the same name are an unrelated deprecated project).
It is an optional extra `aviso` of the `forecast-in-a-box` package, and is not installed by `fiab.sh`.
For a launcher-based installation, install it into the virtual environment of the fiab root, and restart:

```bash
source ~/.fiab/venv/bin/activate   # or ${FIAB_ROOT}/venv
uv pip install 'pyaviso>=2.4,<3'
```

A regular launch or an `upgrade` keeps the package, a `reinstall` removes it and the command needs to be repeated.
For a development checkout, add `--extra aviso` to the `uv sync` command of the [backend development](../../backend/development.md) guide.
When the package is missing and the setting is on, the backend still starts; the listener reports the state `unavailable` with the message `pyaviso not installed`.

### Server address and credentials
FIAB never stores Aviso credentials, and has no setting for them.
`pyaviso` reads them itself, in this order of preference:
- the bearer token in the `AVISO_TOKEN` environment variable,
- `AVISO_USERNAME` together with `AVISO_PASSWORD`,
- the credentials file `~/.config/aviso/credentials.yaml`.

The base URL is `fiab__aviso__base_url` if set, otherwise `AVISO_BASE_URL`, otherwise the `base_url` of `~/.config/aviso/config.yaml`.
These must be present in the environment of the backend process (for a service, in its unit or env file).
The production server address, and the event types and filter keys available on it, are deployment-specific.
To discover them, use the `aviso` command line client, or in Python `client.schema().event_types` and `client.schema_for("mars")` of `pyaviso.AvisoClient`.

### Listener status
`GET /api/v1/trigger/operational/listener/status` (any authenticated user) returns:
- `state` -- one of:
  - `disabled`: the listener is not enabled, no thread is registered,
  - `starting`: the thread has started,
  - `waiting_prerequisites`: waiting for the plugin catalog and the gateway to be initialized, which precedes opening any connection,
  - `listening`: connected, or idle when there is no enabled trigger (the `message` says `no enabled triggers`),
  - `backoff`: the connection failed, the listener waits `reconnect_backoff_seconds` and rebuilds it; see `last_error`,
  - `unavailable`: the listener cannot work, for example `pyaviso` is missing or fails to import, or a prerequisite failed; it stays so until the backend is restarted,
  - `stopped`: the backend is shutting down,
- `message`, `last_error` -- the short explanation and the most recent error text, if any,
- `active_triggers` -- the number of enabled triggers the stream was opened for,
- `last_event_at` -- when the listener last passed an event to the handling,
- `stuck_claims` -- see below.

The listener never delays the backend startup: the state is reported at once, and the connection to Aviso is opened only afterwards.
A connection which cannot be established is not a startup failure, it shows as `backoff`.
Creating, updating or deleting a trigger makes the listener reload its triggers and reopen the stream.

### Handled events
`GET /api/v1/trigger/events/list?experiment_id=<id>` lists the events a trigger has handled, most recent first, with `page` and `page_size`.
Each entry has the `source` (`aviso`, or `synthetic` for events fired manually), `event_type`, `sequence`, `status`, `run_id` and `message`.
The `status` is:
- `claimed`: the event was taken and the run is being submitted,
- `submitted`: a run was created, see `run_id`,
- `failed`: submitting failed, see `message`, for example a glyph name collision or a missing blueprint,
- `skipped_stale`: the event was published more than `max_acceptable_delay_hours` ago, and is recorded without a run.

### Guarantees
- At most one run per event.
  An event is identified by the trigger, source, event type and sequence number, and is claimed with a unique database record before a run is submitted.
  Redelivery, overlapping replays and a restart cannot create a second run.
- A failed event is not retried automatically.
  The run itself, if it got created and then failed, can be restarted with the run restart route; for an event which created no run, fire it again manually.
  One failed event does not hold back the others.
- Stuck claims.
  If the backend dies between claiming an event and recording its outcome, the record stays `claimed` and the event is not retried, since a run may or may not have been created.
  `stuck_claims` in the listener status counts such records older than 10 minutes across all triggers.
  Check the runs of the trigger and the logs, then handle the event by hand.
- Replay after a restart.
  On start, and whenever triggers reload, the listener asks Aviso to replay events from the later of: now minus the trigger's `max_acceptable_delay_hours` (default 24), and the creation time of the trigger's latest version.
  Events published before the latest version are never replayed for it.
  Since every update (including enabling a disabled trigger) creates a new version, events from before the update are not replayed after it.
  Already handled events are skipped thanks to the records above.
  If Aviso cannot serve the replay (a history gap), that trigger is reopened at the live edge and the error appears as `last_error`.
  It stays at the live edge, without replay, until the trigger is updated, disabled or deleted, or the backend restarts.
- Missing event time.
  A notification without a valid CloudEvent time is handled with its receipt time as the publication time, so the stale protection does not apply to it, and the listener logs a warning once per trigger and connection.

The event records are not cleaned up automatically.
The trigger runs as its creator, and a run it submits carries the context `aviso:<event_type>#<sequence>`.

### Testing without a server
An admin may fire a synthetic event at a trigger with `POST /api/v1/trigger/operational/fire`, which goes through the same handling as a real one, see the [user guide](../userGuide.md#testing-a-trigger).

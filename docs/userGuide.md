# Installation

Everything is done via using the `fiab.sh` script.
Execute once in your terminal `curl -fsSL https://raw.githubusercontent.com/ecmwf/forecast-in-a-box/main/scripts/fiab.sh -o fiab.sh`, or download the file by hand.
It is *not* recommended to download the whole git repository -- do that _only_ if you want to actively develop forecast-in-a-box itself, and in that case consult the respective guides instead.

Then just run `bash ./fiab.sh` every time you feel like forecasting something.

The script does not upgrade itself regularly -- you best run an upgrade from the web interface itself.
Alternatively, consult the script's help on how to run an upgrade or a full reinstall.

# Usage
The run of the `fiab.sh` script should open a window in your browser, with url like `localhost:8000`.
See [troubleshooting](troubleshooting.md) if it doesn't.

The browser app itself contains embedded help.

# Event triggers
A trigger starts a run of one of your blueprints whenever a matching event arrives from an [Aviso](https://github.com/ecmwf/aviso-client) server -- for example when a new forecast is published -- and passes the fields of the event to the run as glyphs.
Triggers are available only through the REST API for now; there is no page for them in the web interface yet.
The server must have the listener enabled by the operator, see [tuning and configuration](operator/tuningAndConfiguration.md#event-triggers-aviso).
All routes below are under `/api/v1/trigger` and need the same authentication as the rest of the API.

## Preparing the blueprint
The glyphs of the event (see below) must be declared in the blueprint as local glyphs, with a placeholder value, so that the blueprint is valid and can be saved before any event exists.
The value of the event replaces the placeholder in every run the trigger submits.
For example, in the `local_glyphs` of the blueprint:

```json
{"local_glyphs": {"aviso_date": "20000101", "aviso_step": "0"}}
```

and then use `${aviso_date}` and `${aviso_step}` in the configuration of the blocks.
Without the declaration, the blueprint does not know the glyph.
Glyph values are always strings.

## Creating a trigger
Send `PUT /api/v1/trigger/create`:

```json
{
  "blueprint_id": "<id of your blueprint>",
  "blueprint_version": 1,
  "event_type": "mars",
  "filter": {"class": "od", "stream": "oper"},
  "glyph_map": {"date": "forecastDate"},
  "max_acceptable_delay_hours": 24,
  "enabled": true,
  "display_name": "Run on new operational forecast"
}
```

Only `blueprint_id` and `event_type` are required.
- `blueprint_version` -- the blueprint version to run; the latest if omitted.
- `event_type` and `filter` -- which Aviso events match.
  The event types and filter keys depend on the Aviso server of your deployment; ask your operator, or list them with `client.schema().event_types` and `client.schema_for("mars")` of the `pyaviso` Python package, or with the `aviso` command line client.
- `glyph_map` -- optional extra glyph names, see below.
- `max_acceptable_delay_hours` -- default 24; an event published longer ago than this is recorded but does not start a run, and after a restart only events younger than this are replayed.
- `enabled` -- default true; a disabled trigger ignores events.
- `display_name`, `display_description`, `tags` -- optional.

The response holds the `experiment_id` of the trigger.
Further routes:
- `GET /api/v1/trigger/get?experiment_id=<id>` and `GET /api/v1/trigger/list` (with `page` and `page_size`) show your triggers,
- `POST /api/v1/trigger/update` with `experiment_id`, the current `version` and any of `event_type`, `filter`, `glyph_map`, `max_acceptable_delay_hours`, `enabled`; the fields left out keep their value, and a stale `version` returns 409,
- `POST /api/v1/trigger/delete` with `experiment_id` and `version`.

The trigger runs the blueprint with your permissions, as you were when you created it.
Events published before the latest version of a trigger (so, before its last update) are not replayed for it.

## Glyphs of an event
The run receives these glyphs:
- `aviso_<key>` for each scalar field of the event identifier, for example `aviso_date`, `aviso_step`, `aviso_class`.
  Characters of the key other than letters, digits and underscore are replaced by underscores.
  Fields holding a list are not passed.
- `aviso_sequence` -- the sequence number of the event,
- `aviso_event_type` -- the event type,
- `aviso_published` -- the publication time of the event.

If two fields would give the same glyph name, the event is not run and is recorded as `failed`.

The `glyph_map` copies an identifier field under another glyph name, in addition to the `aviso_` one.
In the example above, the glyph `forecastDate` gets the `date` of the event.
The target must be a valid glyph name, must not start with `aviso_`, and must not be an intrinsic glyph name; the trigger is rejected with 422 otherwise.
The target also has to be declared as a local glyph in the blueprint.
If the field is missing in an event, the target is not set and its placeholder applies.
The glyph `submitDatetime` remains the time at which the run was submitted.

## Testing a trigger
An administrator can fire a synthetic event with `POST /api/v1/trigger/operational/fire`, without any Aviso server:

```json
{"experiment_id": "<trigger id>", "identifier": {"date": "20261103", "step": 6, "class": "od"}}
```

The event has the event type of the trigger, and goes through the same handling as a real one: it is recorded, and a run is submitted.
The response shows the `status` (`submitted`, `failed`, `skipped_stale`, `ignored_disabled`, ...), the `run_id` and a `message` on failure.
The `filter` is not applied to a synthetic event, so give an identifier the real event could have.
Each call is a new event, recorded with the source `synthetic`, and never collides with a real one.
Non-admin users get 403.

## Viewing runs and events
- `GET /api/v1/trigger/runs/list?experiment_id=<id>` lists the runs of the trigger; each has the `run_id` and an `experiment_context` such as `aviso:mars#1234`, which identifies the event.
  The runs also show up with the other runs, and are managed with the `/api/v1/run` routes.
- `GET /api/v1/trigger/events/list?experiment_id=<id>` lists the events the trigger has handled, most recent first, with the `status`:
  `submitted` (see `run_id`), `failed` (see `message`), `skipped_stale`, or `claimed` while being handled.
- A failed event is not retried automatically.
  If its run was created but failed, restart the run; otherwise ask an administrator to fire the event again, or wait for the next event.
- `GET /api/v1/trigger/operational/listener/status` shows whether the server listens to Aviso at all.

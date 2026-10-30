# largeE2E

"DA BIG TEST" -- a small number of heavyweight, slow, real end-to-end scenarios exercising a
*running* Forecast-in-a-Box backend, e.g. actually downloading a real ML model checkpoint and
running a real forecast through it. Not run as part of `just val`/CI on every push -- see
`.github/workflows/bigtest.yml` for when it does run.

## What this is (and isn't)

This is **not** `backend/tests/unit` or `backend/tests/integration`: it does not launch the
backend in-process, does not use pytest, and does not import `forecastbox` at all (see "Why no
`forecastbox` import?" below). Instead, every scenario is a plain script that talks to an
**already running, already configured** backend purely over HTTP, exactly like a real client
would.

This is also not `backend/tests/adhoc` (which is about testing plugin-install machinery against a
disposable scratch venv, and never starts a full backend at all).

## Scenario assumptions

Every `case_*.py` module in this directory is one scenario. Each one:

- assumes the backend is **already running and fully configured**, with whatever plugins it needs
  already installed -- a scenario never installs a plugin itself, and never assumes it started the
  backend (see `find_plugin_id` in `common.py` for how a scenario locates "the plugin that exposes
  block X" instead of hardcoding a plugin id);
- assumes the backend is **not** in a clean state -- there may be pre-existing blueprints, runs,
  glyphs, downloaded models, etc, and a scenario must not depend on their absence;
- assumes it is **not the only thing running** against this backend -- other scenarios, other
  manual testing, or even another concurrent invocation of the very same scenario may be hitting
  the backend at the same time. Concretely this means:
  - a scenario must tolerate a model download it triggers already being in progress (or already
    finished) because someone/something else triggered it first -- the backend's own artifact
    manager already deduplicates concurrent downloads of the same artifact, so scenarios just poll
    for completion rather than trying to coordinate this themselves;
  - a scenario must never write to a fixed, shared filesystem path -- use the intrinsic
    `${runId}`/`${attemptCount}` glyphs (or equivalent) to keep every run's output unique, the same
    way `case_checkpointMatrix.py` does for its grib sink.

## Layout

- `common.py` -- shared helpers: backend client construction, readiness polling, plugin-id
  resolution, a generic retry loop. No dependency beyond the standard library and `httpx`.
- `case_checkpointMatrix.py` -- opt-in (see below): runs a list of checkpoints, each against its
  own list of input sources (eg opendata, polytope), through anemoiSource -> gribSink and
  anemoiSource -> mapPlotSink (2t, msl, tp), and checks the grib files and png plots.
- `case_sourceMatrix.py` -- opt-in (see below): runs the demo checkpoints against a list of input
  sources, through anemoiSource -> gribSink, to find out which sources work.
- `case_scheduledJob.py` -- placeholder for now (trivially succeeds); the real scenario (create a
  schedule, observe the background scheduler actually produce a run) still needs reworking against
  the current `/experiment/*` API and a dedicated test plugin -- see the draft kept in that file.
- `run_scenarios.py` -- discovers every `case_*.py` module and runs its `run(client)` entrypoint.
- `scripts/start_backend.sh` / `scripts/stop_backend.sh` -- background/foreground a
  `scripts/fiab.sh`-managed backend for CI use (see `justfile`).
- `justfile` -- `install` / `start` / `run` / `stop` (see below).

## Why no `forecastbox` import?

`common.py`, `run_scenarios.py` and every `case_*.py` build request bodies as plain dicts/JSON and
never import `forecastbox`/`fiab_core`. This means `just run` (really, `uvx --with httpx python
run_scenarios.py`) needs nothing beyond `uv`/`uvx` and network access to the backend under test --
no backend virtualenv, no editable install, no dependency on which packages happen to be on
`PYTHONPATH`. This is what makes it possible to run the very same scenarios against a backend a
developer started themselves (e.g. via `just dev` from the repository root), not just against one
this directory's own `justfile` started.

## Running

### Against your own already-running backend (e.g. `just dev`)

```bash
cd backend/tests/largeE2E
just run
# or directly:
# uvx --with httpx python run_scenarios.py
```

By default scenarios talk to `http://localhost:8000/api/v1` (the default port for both `just dev`
and `scripts/fiab.sh run`). Point at a different instance with `FIAB_E2E_BASE_URL`. Pass scenario
names to run only those, eg `just run checkpointMatrix`.

### Checkpoint matrix

`case_checkpointMatrix.py` does nothing unless `FIAB_E2E_CHECKPOINTS` is set, since its runs need
real input data (and credentials, for polytope) and possibly a large GPU. The checkpoints and their
input sources are listed in `MODELS` in that file. The variable is a `;`-separated list of entries:
a checkpoint from `MODELS`, a preset from `PRESETS` (`oper` for every checkpoint in `MODELS`, `demo`
for `aifs-global-o48` and `BRIS-Europe-2025.10` only), or `<checkpoint>=<source>,<source>` for any
checkpoint the backend knows about. A checkpoint is its local id, looked up across the configured
artifact stores, or `<store>:<local id>` to pick the store:

```bash
FIAB_E2E_CHECKPOINTS="aifs-global-o48" just run checkpointMatrix
FIAB_E2E_CHECKPOINTS="demo" just run checkpointMatrix
FIAB_E2E_CHECKPOINTS="oper" just run checkpointMatrix
FIAB_E2E_CHECKPOINTS="graceful-gazelle-v2=polytope:mars;local:aifs-single-mse-2.0=opendata:ecmwf:highres" just run checkpointMatrix
```

Every combination is attempted and the results are summarised at the end; the scenario fails if
any combination failed. Each run logs, once over, the wall time of each run phase -- input data fetch, model run, grib
output and plots, read from the cascade task tracing markers in the run logs (`GET /run/logs`) -- and
the total run time, for failed runs too; the summary lists them for all runs.

### Source matrix

`case_sourceMatrix.py` does nothing unless `FIAB_E2E_SOURCES` is set, since several input sources
need credentials (polytope). It runs the `demo` checkpoints against `all` the input sources listed in
`SOURCES` in that file (all those of the anemoiSource block but `mars`, which needs a MARS client, the
AWS open data mirror, which is too slow, and `dummy`, which does not run with anemoi-inference>=0.13), or
against a `,`-separated list of input sources, and summarises the results with the same timings as
the checkpoint matrix. A run is stopped after 45 minutes, as a source can hang rather than fail:

```bash
FIAB_E2E_SOURCES="all" just run sourceMatrix
FIAB_E2E_SOURCES="dummy,opendata:aws:lowres" just run sourceMatrix
```

Run it against a backend that does not cache input data (`EARTHKIT_DATA_CACHE_POLICY=off` in its
environment, the earthkit-data default), so the input fetch times measure the sources rather than the
cache. The scenario logs, per run, the data added to the earthkit-data cache
(`FIAB_E2E_EARTHKIT_CACHE_DIR`, by default `/tmp/earthkit-data-$USER`) and the cache hits, and warns
when runs hit it. The log ends with the sources ranked by their mean input fetch time, slowest first.

### Fully self-contained (CI-style)

```bash
cd backend/tests/largeE2E
just install   # sets up a scratch fiab venv/config under ./.fiab, via scripts/fiab.sh warmup
just start     # launches the backend in the background, waits until it's ready
just run
just stop      # always run this, even if `just run` failed -- see .github/workflows/bigtest.yml
```

`just install`/`just start`/`just stop` are entirely independent of `just run`: they exist so CI
can manage a throwaway backend, but a developer pointing `just run` at their own instance never
needs them.

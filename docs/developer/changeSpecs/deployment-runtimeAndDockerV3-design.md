# Application runtime model and Docker v3: design

## Status

Proposal (step 1 of the [changeSpecs workflow](README.md)), open for feedback.

- Covers the runtime, storage, and container deployment architecture so it can proceed immediately without waiting on repository restructuring or CI/CD changes.
- Companion to [ci-repoLayoutAndRelease-design.md](ci-repoLayoutAndRelease-design.md), which covers repository layout, `cd-major`/`cd-minor-*` workflows, `fiab-core` locking, pre-release testing, and replacing `scripts/fiab.sh`.
- Relates to the in-app upgrade UI of [#187](https://github.com/ecmwf/forecast-in-a-box/issues/187): disables (or gates off) the in-place `POST /admin/release` mutation path rather than removing the endpoint, so it can later delegate to the `fiab upgrade` / `install.sh` mechanism in [ci-repoLayoutAndRelease-design.md](ci-repoLayoutAndRelease-design.md) for standalone installs while staying disabled in container/managed deployments.
- Leaves `scripts/fiab.sh` untouched and backwards-compatible for existing workstation users (the explicit `upgrade`/`reinstall` commands from [#757](https://github.com/ecmwf/forecast-in-a-box/pull/757) remain valid until the Phase 5 transition in [ci-repoLayoutAndRelease-design.md](ci-repoLayoutAndRelease-design.md)).
- Explicitly defers database migrations ([backend-db_migrations.md](backend-db_migrations.md)), plugin environment generations ([plugins-candidate_venvs.md](plugins-candidate_venvs.md)), state/version lifecycle policies (upgrade, rollback, side-by-side versions), and Kubernetes operator support (Docker v4). Note: [plugins-candidate_venvs.md](plugins-candidate_venvs.md) needs reconciling so Forecastbox version changes remain owned by the deployer/image rather than plugin generations.

## Context

### Current state

Forecast-in-a-Box is started in four different ways today, each reimplementing parts of the runtime bootstrap:

- **`scripts/fiab.sh`** -- creates `~/.fiab` (`FIAB_ROOT`), downloads `pylock.toml` and `config.toml`, creates `$FIAB_ROOT/venv`, writes `firstrun` and `release` markers, exports `FIAB_FIRSTRUN`, `FIAB_RELEASE_MARKER`, and `EARTHKIT_DATA_CACHE_*`, and runs `python -m forecastbox.entrypoint.{main,warmup,bootstrap.service}`.
- **`just dev`** -- syncs `backend/.venv`, sets `FIAB_ROOT=backend/.fiab`, writes a fake `pylock.toml.timestamp` (`d0.0.1`), duplicates the `firstrun` marker logic, and runs `entrypoint.main`.
- **`deployment/v2`** -- `Dockerfile-release` fetches `scripts/fiab.sh` from `main`, runs `fiab.sh warmup <tag>` at build time, and uses `fiab.sh` as the container entrypoint. `Dockerfile-dev` syncs the source tree and runs `just dev`.
- **`deployment/ewc`** -- builds the wheel into `/app/.venv` and reimplements the runtime bootstrap in its own `docker-entrypoint.sh`.

### Observed problems

1. **Code and state share one directory.** In `scripts/fiab.sh` and `deployment/v2`, the venv lives inside `~/.fiab` alongside databases and config. Mounting a persistent volume at `~/.fiab` in a container shadows the installed venv.
2. **Ambiguous `FIAB_ROOT` naming.** `scripts/fiab.sh` documents `FIAB_ROOT` as the installation directory (containing `venv/` and `uvdir/`), while `backend/src/forecastbox/utility/config.py` assigns it to `fiab_home` and uses it exclusively for state, config, and data (`user.db`, `job.db`, `config.toml`, `data_dir`).
3. **Runtime bootstrap is duplicated four times.** Directory creation, config seeding, first-run detection, release identity, and earthkit cache defaults are split across shell scripts, the root `justfile`, and Dockerfiles.
4. **Storage classes are conflated.** Immutable model artifacts (weights, checkpoints) and mutable job inputs/outputs share a single `data_path`. Caches and scratch space are only partly configurable.
5. **Fragmented container setups.** `deployment/ewc`, `deployment/v2`, metno/fnmi Docker setups, and manual Spark deployments have diverged and would benefit from unification into a single maintainable setup.
6. **Implicit backend couplings to `fiab.sh`.** The backend reads `FIAB_RELEASE_MARKER` and `FIAB_FIRSTRUN`, parses `pylock.toml.timestamp`, and references `refs/tags/${TAG}/install/artifacts.json` in `utility/config.py`.

## Goals

- **G1** Self-sufficient runtime: once installed in a venv, the backend runs directly via its `fiab` console script without an external launcher script.
- **G2** Unified runtime behaviour across Docker v3, `just dev`, standalone venvs, and legacy `scripts/fiab.sh`.
- **G3** Strict separation of installed Code from persistent State and data, with a single overridable `FIAB_ROOT` organized into XDG-shaped storage-class subdirectories (`config/`, `state/`, `share/{artifacts,jobs}`, `cache/`, `tmp/`), each independently mountable or configurable.
- **G4** A Docker v3 deployment unifying Spark, EWC, DestinE, and standard Linux x86 + NVIDIA GPU hosts, retiring both `deployment/ewc` and `deployment/v2`.
- **G5** Keep future directions open -- multi-user shared servers and hubs, side-by-side versions, DB migrations or export/import, plugin generations, real XDG directories (`~/.config/fiab`, `~/.local/...`), and Kubernetes (v4) -- without committing to them prematurely.

## Non-goals

- Repository layout restructuring, release workflow redesign (`cd-major`/`cd-minor-*`), `fiab-core` locking, and pre-release publishing (see [ci-repoLayoutAndRelease-design.md](ci-repoLayoutAndRelease-design.md)).
- Replacing or modifying `scripts/fiab.sh`. Existing `fiab.sh` continues working unchanged through backwards-compatible module entry points (with optional legacy flat-layout detection while both layouts coexist).
- Choosing a version/state lifecycle policy (in-place upgrade vs per-version state copies, DB migrations vs export/import, or a workstation version manager).
- Designing non-filesystem storage backends (for example S3/object stores) or Kubernetes operators (Docker v4).

## Runtime model

### Console script (`fiab`)

The `forecast-in-a-box` package exposes a Python console script named `fiab` in `backend/pyproject.toml` with subcommands matching the existing entry points:

- `fiab run` -- start the application (`entrypoint.main`).
- `fiab service` -- start in service mode (`entrypoint.bootstrap.service`, unified with `run` where practical).
- `fiab warmup` -- prepare the environment without starting the server (see [Warmup vs. first-run](#warmup-vs-first-run)).

**Note on the Rust `cli/` binary:** `cli/crates/fiab-cli/Cargo.toml` currently defines `[[bin]] name = "fiab"`, but it is only built in `ci.yml` and is not published or installed anywhere. Shipping the Python console script as `fiab` has no current conflict and establishes the single user-facing CLI name; if parts of the backend or CLI are later rewritten in Rust, the Rust binary can adopt the same `fiab` contract (or ship client-only tooling under a distinct name such as `fiab-cli`).

**Backwards compatibility with `scripts/fiab.sh`:** The existing `python -m forecastbox.entrypoint.{main,warmup,bootstrap.service}` module paths remain working and delegate to the same code. The backend tolerates (ignores or falls back gracefully from) `FIAB_RELEASE_MARKER`, `FIAB_FIRSTRUN`, and `pylock.toml.timestamp` when invoked by `scripts/fiab.sh`.

### Runtime responsibilities moved into the application

All runtime bootstrap currently duplicated across `fiab.sh`, `justfile`, and container entrypoints moves into the Python entrypoint:

- **Storage initialisation.** Create configured directories for local storage classes if missing.
- **Config layering.** Precedence from lowest to highest:
  1. Version defaults shipped inside the wheel as package data (replacing `install/config.toml` downloads from GitHub tags).
  2. Optional site-level config (location via env var or fixed system path; see [Open questions](#open-questions)).
  3. User config in `FIAB_ROOT/config/config.toml`.
  4. Environment variables.
- **First-run detection.** Detect "state not yet initialised" directly from `FIAB_ROOT/state` instead of relying on the `FIAB_FIRSTRUN` env var or `firstrun` file.
- **Release identity.** Read the running version from installed package metadata (`importlib.metadata`) instead of `FIAB_RELEASE_MARKER` or `pylock.toml.timestamp`.
- **Environment defaults.** Apply defaults such as `EARTHKIT_DATA_CACHE_POLICY` and `EARTHKIT_DATA_MAXIMUM_CACHE_SIZE` via `os.environ.setdefault(...)` in the entrypoint **before** importing `earthkit` or any module that transitively imports it, so import-time reads see the defaults.
- **Admin release endpoints.** Disable (or capability-gate) `POST /admin/release` so it no longer mutates the lock and release marker in place, while keeping the endpoint surface intact for [#187](https://github.com/ecmwf/forecast-in-a-box/issues/187). Release status reporting stays read-only/notify-only (optionally reading latest version from the PyPI JSON API instead of the rate-limited GitHub API). Once the `fiab upgrade` / `install.sh` mechanism in [ci-repoLayoutAndRelease-design.md](ci-repoLayoutAndRelease-design.md) is available, `POST /admin/release` can be wired to it for standalone deployments while remaining disabled in containers and operator-managed deployments.

### Warmup vs. first-run

Today, `warmup` conflates two operations that belong to different storage classes:

1. **Installing default plugins** -- modifies the **Code** environment.
2. **Initialising instance state** -- creates databases/config in **State** (`FIAB_ROOT/state`).

In containers, if `warmup` runs at image build time to pre-install default plugins, any state written into `FIAB_ROOT` is shadowed when a persistent volume is mounted at runtime. Conversely, if an immutable container starts with an empty mounted `FIAB_ROOT`, "state not yet initialised" must not attempt to mutate a read-only code environment.

Therefore, this design separates these concerns cleanly:
- State initialisation always runs on startup when `FIAB_ROOT/state` is empty.
- Default plugin installation is controllable independently (for example, `fiab warmup --plugins` at image build time, and a config/flag to disable runtime plugin installation in immutable container deployments).

## Storage classes and `FIAB_ROOT`

### `FIAB_ROOT`

`FIAB_ROOT` is the single overridable root directory for runtime storage classes, organized into XDG-shaped subdirectories:

```text
<FIAB_ROOT>/            # default ~/.fiab (workstation), /var/lib/fiab (Docker), or user-chosen
  config/               # config.toml (can be mounted read-only)
  state/                # user.db, job.db (small persistent RW volume)
  share/
    artifacts/          # model weights/checkpoints (can be mounted read-only shared NFS)
    jobs/               # mutable job inputs/outputs (large RW volume)
  cache/                # uv, earthkit-data, cascade task venvs (fast local exec-able disk)
  tmp/                  # scratch / cascade logs (ephemeral local disk)
```

Resolution order:
1. `FIAB_ROOT` environment variable, if set.
2. `~/.fiab`.

Code is kept **strictly outside** `FIAB_ROOT` in containers (for example `/opt/fiab/.venv`) and dev (`python/.venv`), so mounting either a single volume at `FIAB_ROOT` (e.g. `-v fiab:/var/lib/fiab`) or separate volumes onto subdirectories inside `FIAB_ROOT` (e.g. `-v nfs:/var/lib/fiab/share/artifacts:ro`, `-v nvme:/var/lib/fiab/cache`) works without ever shadowing the application venv. On standalone workstations, `FIAB_INSTALL_DIR` is independently overridable (and may default to `$FIAB_ROOT/app` or an XDG location once decided).

### Optional coexistence with legacy flat `~/.fiab` (removable)

Because all new paths live inside clean subdirectories (`config/`, `state/`, `share/`, `cache/`, `tmp/`), they have zero filename collisions with the existing flat `~/.fiab` layout (`user.db`, `job.db`, `config.toml`, `data_dir/`, `venv/`, `uvdir/`).

If in-place coexistence with existing `scripts/fiab.sh` installations is desired during the transition window, the backend can optionally detect the legacy flat layout (when `FIAB_RELEASE_MARKER` is set by `scripts/fiab.sh`, or when flat `job.db`/`config.toml` exist directly under `FIAB_ROOT` without `state/`). If the team instead opts for a clean wipe/cutover of existing installations, this detection block is self-contained and can be removed cleanly.

### Storage classes

| Class | Contents | Properties | Default when unconfigured |
|---|---|---|---|
| **Code** | Application venv (and future plugin generations) | Rebuildable from lock; replaced, never migrated | **Never** inside `FIAB_ROOT` in Docker/dev (`/opt/fiab/.venv` in Docker, `python/.venv` in dev, `FIAB_INSTALL_DIR` in standalone) |
| **Config** | User `config.toml` | Small, declarative; may be mounted read-only | `FIAB_ROOT/config` |
| **State** | `user.db`, `job.db`, desired plugin list | Small, mutable, schema-bearing; needs reliable persistent storage | `FIAB_ROOT/state` |
| **Bulk data: Model artifacts** | Model weights, checkpoints | Large, immutable; shareable read-only across users and side-by-side versions | `FIAB_ROOT/share/artifacts` |
| **Bulk data: Job data** | Job inputs and outputs | Large, grows with use | `FIAB_ROOT/share/jobs` |
| **Caches & task environments** | uv cache, earthkit-data cache, cascade task venvs (`CASCADE_VENV_ROOT`), and (if plugins run out-of-process) per-plugin venvs | Rebuildable; may be cleared. Task and plugin venvs require a local exec-mountable filesystem | `FIAB_ROOT/cache` (or platform cache defaults) |
| **Scratch** | Temporary cascade logs (`cascade_logging_base`), per-run temp files | Short-lived; local filesystem | `FIAB_ROOT/tmp` (or system temp) |

Requirements:
- Every storage class has its own configurable location (config key and/or env var) and its own mountable subdirectory under `FIAB_ROOT`.
- Model artifacts and job data are configured separately so multi-user deployments can mount a single shared read-only artifact store across all users and versions.
- Bulk data locations keep URL syntax (`file://`, `ssh://`) so object-store backends can be added later without changing config structure. Local-only classes (Code, Scratch, exec-able task venvs) remain filesystem paths.
- A laptop or dev run with no storage configuration works out of the box using defaults derived from `FIAB_ROOT`.

### Alignment with the XDG Base Directory Specification

Because `FIAB_ROOT` uses XDG-shaped subdirectories whose internal contents are identical to real XDG directories, adopting real XDG defaults later requires only changing the base-directory resolvers in `utility/config.py`:

| Storage class | Single-root (`$FIAB_ROOT`) | Real XDG (future option) | Contents (identical in both) |
|---|---|---|---|
| Executable shim ([ci-repoLayoutAndRelease-design.md](ci-repoLayoutAndRelease-design.md)) | `$FIAB_BIN_DIR` (overridable, e.g. `~/.local/bin/fiab`) | `~/.local/bin/fiab` | `fiab` symlink |
| Code (venv, plugin generations) | `$FIAB_INSTALL_DIR` (overridable, e.g. `/opt/fiab` in Docker) | `${XDG_DATA_HOME:-~/.local/share}/fiab/app` | `v<ver>/venv`, `current` |
| User config | `$FIAB_ROOT/config` | `${XDG_CONFIG_HOME:-~/.config}/fiab` | `config.toml` |
| State | `$FIAB_ROOT/state` | `${XDG_STATE_HOME:-~/.local/state}/fiab` | `user.db`, `job.db` |
| Bulk data | `$FIAB_ROOT/share` | `${XDG_DATA_HOME:-~/.local/share}/fiab` | `artifacts/`, `jobs/` |
| Caches & task environments | `$FIAB_ROOT/cache` | `${XDG_CACHE_HOME:-~/.cache}/fiab` | `uv/`, `earthkit-data/`, `cascade-venvs/` |
| Scratch | `$FIAB_ROOT/tmp` | System temp (`$TMPDIR` / `/tmp`) | cascade logs, run temps |

Notes for adopting real XDG later:
1. **Keep XDG paths on macOS rather than `~/Library/Application Support`:** avoids spaces in Python venv paths, which break `#!` shebangs and shell scripts.
2. **1-to-1 drop-in:** Because each base directory has the exact same internal layout in both modes, moving or symlinking a storage-class directory between `$FIAB_ROOT/<class>` and real XDG (`~/.local/.../fiab`) requires no internal restructuring.

## Deployment paths

### Docker v3

Docker v3 replaces both `deployment/ewc` and `deployment/v2` (both are deleted once v3 is validated). Breaking changes from v2/ewc are acceptable to establish a clean, stable v3 layout; full Kubernetes operator support is deferred to v4.

**Target environments:** Spark, EWC, DestinE deployments, and standard Linux x86 hosts with NVIDIA GPUs.

**Image structure (single multi-stage `Dockerfile`):**
- **`base` stage:** OS dependencies, GPU/CUDA runtime (or base/GPU variant; see [Open questions](#open-questions)), `uv`, pinned Python via `uv python install`, non-root user, default `FIAB_ROOT` (for example `/var/lib/fiab`).
- **`release` stage:** Installs locked dependencies (`pylock.toml`) and the `forecast-in-a-box` wheel into `/opt/fiab/.venv` (strictly outside `FIAB_ROOT`). Accepts either a PyPI release version or a local wheelhouse directory (`COPY wheelhouse/ ...`, including its lock) so unreleased branches and CI builds test the exact same image structure as releases. If default plugins are baked into the image (see [Open questions](#open-questions)), `fiab warmup --plugins` runs here against `/opt/fiab/.venv` without touching `FIAB_ROOT`. Sets `ENTRYPOINT ["/opt/fiab/.venv/bin/fiab"]` and `CMD ["service"]` (or `["run"]`).
- **`dev` stage (optional):** Extends `release` by keeping `/opt/fiab/.venv` inside the container (matching the container's Linux ABI and Python) and installing local packages in editable mode (`uv pip install --no-deps -e ...`) against a bind-mounted host source tree. Host `.venv` directories are never bind-mounted into the container to avoid associated compatibility issues.

**Container runtime layout:**
- Code lives in `/opt/fiab/.venv` (immutable in `release`).
- Persistent data/state can be mounted as a single volume at `FIAB_ROOT` (e.g. `-v fiab-state:/var/lib/fiab`), or mounted per storage-class subdirectory inside `FIAB_ROOT` (e.g. `-v artifacts:/var/lib/fiab/share/artifacts:ro`, `-v state:/var/lib/fiab/state`, `-v cache:/var/lib/fiab/cache`).
- No dependency on `scripts/fiab.sh` at build time or run time.

### Development (`just dev`)

`just dev` becomes:
1. Build frontend if stale (unchanged).
2. Sync `backend/.venv` (outside `FIAB_ROOT`).
3. Set `FIAB_ROOT=backend/.fiab` and invoke `fiab run`.

The fake `pylock.toml.timestamp`, `FIAB_FIRSTRUN` marker handling, `mkdir -p .fiab/data_dir`, and manual config copying are removed from the root `justfile`. `just dev reinstall` remains a thin dev helper that drops local dev DBs and re-syncs the venv.

### Standalone (direct venv and legacy `scripts/fiab.sh`)

- Any deployer or user installing the wheel + lock into a venv outside `FIAB_ROOT` runs `fiab` directly with the exact same runtime behaviour as Docker v3 and `just dev`.
- `scripts/fiab.sh` is left untouched in this spec and continues working via the `python -m` entry points (and optional legacy flat-layout detection).

## Keeping multi-user and future version management open

Version management and state evolution are intentionally parked for a separate spec. Disentangling three concerns ensures this spec closes off no future options:

1. **Code switching** is owned by the deployer (Docker image tag, hub spawner profile, or venv path). Because Code is outside `FIAB_ROOT` in containers/dev and versioned in `FIAB_INSTALL_DIR` for standalone installs, switching code versions is stateless.
2. **State compatibility** (future spec: DB migrations vs. versioned export/import, schema version check + refuse-to-start on newer state) operates on a single `FIAB_ROOT` at runtime.
3. **State lifecycle & housekeeping** (single `FIAB_ROOT` with snapshots, cloned `FIAB_ROOT` on upgrade for rollback, or per-major `FIAB_ROOT` for side-by-side versions in a hub) is purely a deployment policy controlling which directory is mounted as `FIAB_ROOT`.

Multi-user deployments -- both **shared multi-user servers** (one Docker v3 instance, multiple logged-in users) and **hub/spawner setups** (one container per user, curated image-tag profiles) -- build directly on this spec's `FIAB_ROOT` + shared read-only Artifacts separation. Prefix-safe serving (`root_path` / runtime frontend base URL) and Cascade gateway scoping (shared vs. per-job/per-version) remain separate follow-ups.

## Open questions

1. **Fate of `install/artifacts.json` and `install/plugins.json`:** `utility/config.py` currently references `refs/tags/${TAG}/install/artifacts.json`, and `cd-artifacts_update.yml` updates it. Should `artifacts.json` and `plugins.json` move into package data alongside default config, or stay at a stable external URL?
2. **Site-level config location:** Fixed path (e.g. `/etc/fiab/config.toml`), an env var (e.g. `FIAB_SITE_CONFIG`), or both?
3. **Storage class config keys and env vars:** Exact naming for model artifacts, job data, caches, and scratch paths, and whether existing `data_path` stays as a fallback when the split keys are unset.
4. **Docker v3 image matrix:** Can a single multi-arch (`amd64`/`arm64`) image cover Spark, EWC, DestinE, and Linux x86 + NVIDIA GPU, or should one parameterized `Dockerfile` (`ARG BASE_IMAGE=...`) publish a slim CPU base image plus a CUDA/Spark variant? Note: prior NVIDIA DGX Spark runs required `UV_EXTRA_INDEX_URL=https://download.pytorch.org/whl/cu130`, `UV_INDEX_STRATEGY=unsafe-best-match`, and `TRITON_PTXAS_PATH=/usr/local/cuda/bin/ptxas` -- `ptxas` is not present in `debian:stable-slim` or injected by `--gpus all`, which points toward needing a CUDA toolkit base image variant for Spark/GPU.
5. **Plugins in Docker v3:** Baked into the image (or derived `FROM` image) with runtime plugin installs disabled, installed into a mounted volume, or both as a deployment option? Note: if plugins move to isolated per-plugin processes with their own venvs (an alternative to [plugins-candidate_venvs.md](plugins-candidate_venvs.md)), `/opt/fiab/.venv` stays completely immutable and plugin venvs can be either pre-baked or mounted on a volume without restarting the backend.
6. **Exact `fiab` subcommand flags and defaults:** Confirm parity with existing `entrypoint/main.py`, `entrypoint/warmup.py`, and `entrypoint/bootstrap/service.py` CLI options.
7. **Default workstation layout (`~/.fiab` vs. XDG):** Keep self-contained `~/.fiab` as the long-term default (with XDG as an opt-in alternative), or switch fresh installs to XDG defaults early while keeping `~/.fiab` as a self-contained option / fallback? Better decided early to avoid changing defaults later.

## Appendix: inventory of current runtime couplings

To be removed from the backend or tolerated cleanly while `scripts/fiab.sh` remains active:

- `scripts/fiab.sh` exports `FIAB_RELEASE_MARKER` and `FIAB_FIRSTRUN`, read by `backend/src/forecastbox/domain/admin/__init__.py`.
- `pylock.toml.timestamp` (`<epoch>:<version>`) is written by `scripts/fiab.sh` without a `v` prefix and by `save_pylock` with one, read by `get_local_release`, faked as `d0.0.1` by the root `justfile` and `deployment/v2/Dockerfile-dev`, and written by `deployment/ewc/docker-entrypoint.sh`.
- The latest release is determined by `scripts/fiab.sh` from `/releases/latest` (excluding pre-releases) and by `get_most_recent_release` from `/releases?per_page=1` (including pre-releases).
- The deprecated `POST /admin/release` writes the release marker and lock without replacing the launcher or checking upgrade scope.
- First-run logic is duplicated in `scripts/fiab.sh` and the root `justfile`.
- Runtime bootstrap is reimplemented in `deployment/v2/Dockerfile-dev` and `deployment/ewc/docker-entrypoint.sh`.
- `EARTHKIT_DATA_CACHE_*` defaults are exported only by `scripts/fiab.sh`.
- `scripts/fiab.sh` invokes `forecastbox.entrypoint.main`, `forecastbox.entrypoint.warmup`, and `forecastbox.entrypoint.bootstrap.service` by module path; comments in those modules refer back to it.
- The default artifact store in `backend/src/forecastbox/utility/config.py` points at `refs/tags/${TAG}/install/artifacts.json`, freezing that repository path from the application side.
- `scripts/fiab.sh` downloads `install/config.toml` once and never refreshes it.
- `deployment/v2/Dockerfile-release` and the user docs fetch `scripts/fiab.sh` from `main`.

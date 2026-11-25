# Repository layout, release pipeline, and pre-release testing: implementation plan

## Purpose and scope

This plan implements [ci-repoLayoutAndRelease-design.md](ci-repoLayoutAndRelease-design.md) across five phases forming a small DAG (`1 -> 2 -> 4 -> 5`, with `1 -> 2 -> 3` as an independent branch after Phase 2):

1. **Phase 1:** Repository layout restructure into standalone sibling packages under `python/{...}` plus a workspace metapackage for editable dev/unit testing.
2. **Phase 2:** Local wheelhouse builder and pre-release testing workflow (consumed by Phases 3 and 4).
3. **Phase 3:** Evaluate and wire `just dev` (and cluster submits) to the local wheelhouse, keeping an editable fallback if startup rebuild cost is noticeable.
4. **Phase 4:** Atomic CD workflows (`cd-major`, `cd-minor-{core,plugins,backend}`), explicit `fiab-core` lock-exclusion policy (Option B, structured for a 1-switch move to Option A), constraints export, and pre-tag Docker v3 gating.
5. **Phase 5:** Replace `scripts/fiab.sh` with a single version-agnostic `install.sh` + wheel-bundled `pylock.toml` (OQ6 Option B, structured for easy rework to Option A/C) and `fiab upgrade`.

Prerequisites / companion work:
- Phases 1--3 are completely independent of [deployment-runtimeAndDockerV3-plan.md](deployment-runtimeAndDockerV3-plan.md).
- Phase 4's pre-tag Docker v3 gate consumes `deployment/v3/` from [deployment-runtimeAndDockerV3-plan.md](deployment-runtimeAndDockerV3-plan.md) Phase 4.
- Phase 5 consumes the `fiab` CLI and `FIAB_ROOT` runtime from [deployment-runtimeAndDockerV3-plan.md](deployment-runtimeAndDockerV3-plan.md) Phases 1--3.

## Decisions and reversibility hooks

The three blocking choices are locked in with explicit abstraction boundaries so each can be reversed later with minimal rework:

- **OQ1 (Package directory layout -> `python/{...}`):**
  - Standalone packages live at `python/backend/`, `python/fiab-core/`, `python/fiab-plugin-ecmwf/`, `python/fiab-plugin-demo/`, `python/fiab-plugin-test/`, `python/fiab-mcp-server/`, with the workspace metapackage at `python/pyproject.toml` (and `python/uv.lock`).
  - **Reversibility hook:** Define a single `PY_ROOT := "python"` variable in the root `justfile`, CI/CD helper scripts, and GitHub Actions workflow `env:` blocks, and avoid hardcoded relative parent paths inside package source code. Moving to repo root (`.`) or `packages/` later requires only `git mv`, updating `PY_ROOT`, updating `setuptools_scm` `root` (`../..` vs `..`), and updating path filters in `.github/workflows/ci.yml` and `.pre-commit-config.yaml`.
- **OQ2 (`fiab-core` locking policy -> Option B: major-version range outside `pylock.toml`):**
  - `forecast-in-a-box` pins `fiab-core>=X,<X+1` in its wheel metadata and excludes `fiab-core` from `pylock.toml` via explicit `LOCK_EXCLUDED_PACKAGES = ("fiab-core",)` in a single lock-generation helper (`scripts/cicd/build_lock.py`).
  - **Reversibility hook:** Because `cd-major` already builds all wheels into a unified local wheelhouse and lock generation is centralized in `build_lock.py`, switching to Option A (exact pin) later only requires removing `"fiab-core"` from `LOCK_EXCLUDED_PACKAGES` and enabling the OQ3 wheelhouse-to-PyPI URL rewrite for `fiab-core` (no redesign of `cd-major` or `cd-minor-*`).
- **OQ6 (`install.sh` + `pylock.toml` hosting -> Option B: wheel-bundled `pylock.toml` + single version-agnostic `install.sh`):**
  - `pylock.toml` (dependencies only, generated with `--no-emit-project`, so there is no circular wheel hash) and a `python-version` file are bundled inside the `forecast-in-a-box` wheel as package data (`forecastbox/utility/release_metadata/`). One tiny, version-agnostic `install.sh` resolves/extracts them via `uv pip install --no-deps --target <tmpdir> forecast-in-a-box==<ver>` (populating `uv`'s cache in the same step) and installs into a versioned venv under an overridable `FIAB_INSTALL_DIR`.
  - **Reversibility hook:** Isolate metadata acquisition inside a single `fetch_release_metadata(version, out_dir)` function in `install.sh`, keep `FIAB_INSTALLER_URL` configurable in `fiab upgrade`, and continue uploading `pylock.toml` as a GitHub Release asset during Phase 4. Switching to Option A/C (per-version hosted `install.sh` or external `pylock.toml`) only changes `fetch_release_metadata` and the default `FIAB_INSTALLER_URL` template.
- **Defaults for non-blocking open questions:**
  - **OQ3 (Wheelhouse-to-PyPI `pylock.toml`):** Run a short `uv` spike as Step 4.0 before implementing Phase 4 lock generation (under Option B this is even simpler since `fiab-core` is excluded, but verifying `--no-emit-project` + `--no-emit-package` with local wheelhouse testing ensures Option A remains a drop-in later).
  - **OQ4 (Plugin constraints):** Export a `constraints.txt` alongside `pylock.toml` in Phase 4 (~5 lines; trivially deleted if plugins move to isolated per-plugin venvs).
  - **OQ5 (Component tags):** Keep `{v,c,p}<version>` tags initially in Phase 4 so `setuptools-scm` and existing release tooling stay predictable; simplify in a follow-up if desired once `cd-major` is proven.
  - **OQ7 (`just dev` wheelhouse cost):** Benchmark in Phase 3 and keep an editable dev fallback recipe/flag (`just dev --editable`) if wheel rebuild latency is noticeable.
  - **Phase 5 `scripts/fiab.sh` transition:** Plan the core `install.sh` + `fiab upgrade` first; treat the `scripts/fiab.sh` stub migration as an additive final step decided when Phase 5 is scheduled.

---

## Phase 1: Repository layout restructure (`python/{...}`)

### Goal

Separate the six Python packages into standalone, workspace-unaware sibling directories under `python/`, with a thin workspace metapackage at `python/pyproject.toml` used exclusively for cross-package editable development and workspace unit tests. Prototype on a disposable branch first, then land in one coordinated PR during a short PR freeze.

### Target layout

```text
python/
  pyproject.toml          # workspace metapackage only (not published)
  uv.lock                 # workspace lock for dev + CI unit tests
  backend/                # standalone forecast-in-a-box package (no [tool.uv.workspace])
    pyproject.toml
    justfile
    src/forecastbox/
    tests/
  fiab-core/              # standalone
  fiab-plugin-ecmwf/      # standalone
  fiab-plugin-demo/       # standalone
  fiab-plugin-test/       # standalone
  fiab-mcp-server/        # standalone
frontend/                 # unchanged at repo root
cli/                      # unchanged at repo root
install/                  # unchanged until Phase 5
deployment/               # unchanged at repo root
scripts/                  # unchanged at repo root
```

### Implementation steps

#### 1.1 Move directories and make each package standalone

1. Move `backend/` -> `python/backend/` and `backend/packages/*` -> `python/*` using `git mv`.
2. In `python/backend/pyproject.toml`:
   - Remove `[tool.uv.workspace]` and `[tool.uv.sources]` (so `python/backend` is completely unaware of the workspace and can be built/tested in isolation without `UV_NO_PROJECT=1`).
   - Update `[tool.setuptools_scm]` `root = "../.."` (two levels up to git root).
3. In every sibling `python/fiab-*/pyproject.toml`:
   - Update `[tool.setuptools_scm]` `root = "../.."` (currently `root = ".."` in `backend/packages/fiab-*/pyproject.toml`).
   - Verify no sibling `pyproject.toml` references `workspace = true` or relative paths into `backend/`.
4. Create `python/pyproject.toml` as a non-published workspace metapackage:
   - Declares `[tool.uv.workspace] members = ["backend", "fiab-core", "fiab-mcp-server", "fiab-plugin-demo", "fiab-plugin-ecmwf", "fiab-plugin-test"]`.
   - Declares `[tool.uv.sources]` with `{ workspace = true }` for all internal packages.
   - Carries shared `[tool.uv]` `environments` / `required-environments` and `[dependency-groups] dev` (including `prek`, `ruff`, `ty`, `pytest`).
   - Run `uv lock` inside `python/` to generate `python/uv.lock` (removing the old `backend/uv.lock`).

#### 1.2 Parameterize `PY_ROOT` and fix all relative path references

Update all repo-level path references using `PY_ROOT := "python"` (or `PY_ROOT=python`) so changing the root later is a single edit:
1. Root `justfile`:
   - Set `py_root := "python"`.
   - Update `fiabfrontend`: symlink `../../../../frontend/dist` into `{{py_root}}/backend/src/forecastbox/static` (or compute relative path via `python3 -c 'import os.path; ...'`).
   - Update `fiabwheel`, `clean`, `val`, and `dev` to use `{{py_root}}/backend` and iterate over `{{py_root}}/fiab-*`.
2. `python/backend/justfile`:
   - Update `perfScripts := "../fiab-core/scripts"`, `perfArtifacts := "../../install/artifacts.json"`, and the perf loop `for perf_dir in ../fiab-*/tests/perf;`.
3. `python/backend/tests/integration/conftest.py`:
   - Replace `pathlib.Path(__file__).parent.parent.parent / "packages" / "fiab-plugin-test"` with `pathlib.Path(__file__).resolve().parents[3] / "fiab-plugin-test"` (resolving sibling package cleanly relative to `python/`).
4. `docs/developer/guidelines/example_dev_config.toml` and `deployment/v2/config.toml-dev` (or `deployment/v3/`):
   - Update editable plugin URLs from `-e file://./packages/fiab-plugin-*` to `-e file://./../fiab-plugin-*` and artifact store path from `file://./../install/artifacts.json` to `file://./../../install/artifacts.json`.
5. `.pre-commit-config.yaml`:
   - Update `ruff-check` and `ruff-format` `files:` regex from `^backend/` to `^python/`.
6. `.github/workflows/ci.yml`, `bigtest.yml`, and existing `cd-*.yml` (keeping existing CD working until Phase 4 replaces them):
   - Update `paths:` triggers and `paths-filter` from `backend/**` to `python/**`.
   - In `ci.yml`, run `uv sync --extra runtime --all-packages` from `python/` (workspace root) and run `uv run prek --all-files` + `just val`.
   - Update `cd-core.yml`, `cd-plugins.yml`, `cd-backend.yml` working directories (`python/fiab-*`, `python/backend`) and remove `UV_NO_PROJECT=1` workarounds where no longer needed.
7. Update `deployment/v2/Dockerfile-dev` (if still present) / `deployment/ewc/Dockerfile` (if still present) or `deployment/v3/Dockerfile` `COPY` paths.

### Phase 1 verification (on disposable branch before coordinated merge)

- Workspace mode: from `python/`, `uv sync --extra runtime --all-packages && uv run prek --all-files`, then `just val` from repo root passes.
- Isolated mode (no `UV_NO_PROJECT=1`): from each standalone `python/<pkg>/`, building a wheel (`python -m build --installer uv .`) and running unit tests in a clean venv succeeds.
- `just dev` starts cleanly with local editable plugins.
- Full `ci.yml` passes on the prototype PR.

---

## Phase 2: Local wheelhouse and pre-release testing

### Goal

Provide a single reusable wheelhouse builder (`scripts/cicd/build_wheelhouse.py` + root `justfile` recipe `just wheelhouse`) that builds candidate wheels for all (or a subset of) packages from any branch into a local directory, plus a matching pre-release verification flow.

### Implementation steps

#### 2.1 Wheelhouse builder (`scripts/cicd/build_wheelhouse.py`)

Create a testable Python CLI script (`scripts/cicd/build_wheelhouse.py`, runnable via `uv run` or stdlib Python) parameterized by `--py-root` (default `python`) and `--out-dir` (default `.wheelhouse/`):
1. Accepts `--packages` (default: all six packages in dependency order: `fiab-core`, `fiab-plugin-test`, `fiab-plugin-ecmwf`, `fiab-plugin-demo`, `fiab-mcp-server`, `backend`), `--version-override` (optional PEP 440 version / dev tag via `SETUPTOOLS_SCM_PRETEND_VERSION`), and `--skip-frontend` (for fast Python-only iterations).
2. If `backend` is included and `--skip-frontend` is not set, invokes `just fiabfrontend` (skipping if `frontend/dist/.git-commit` matches `HEAD`).
3. Builds each package wheel in isolation into `<out-dir>/` using `uv build --wheel --out-dir <out-dir> <py_root>/<pkg>` (clean isolated build; no workspace leakage).
4. Writes a small `<out-dir>/manifest.json` recording package names, wheel filenames, versions, and git commit SHA for downstream CI/Docker/dev steps.
5. Add a root `justfile` recipe `just wheelhouse [out_dir=".wheelhouse"]` and add `.wheelhouse/` to `.gitignore`.

#### 2.2 Pre-release testing workflow

1. Add a helper `scripts/cicd/test_wheelhouse.py` (and `just test-wheelhouse`) that:
   - Creates a clean temporary venv outside the workspace.
   - Installs `forecast-in-a-box` and test plugins from `--find-links <wheelhouse> --no-build-isolation` (resolving third-party deps from PyPI or an optional mirror/cache).
   - Runs backend unit + integration tests and (optionally) plugin tests against the installed wheels rather than editable source.
2. Document and wire PEP 440 pre-release rehearsal (`workflow_dispatch` with `prerelease` / `testpypi` input, GitHub pre-release flag `prerelease: true` so `/releases/latest` is unaffected, and scratch Docker tag `:<tag>-rc<N>`).
3. Ensure the wheelhouse layout matches `deployment/v3/Dockerfile`'s `INSTALL_SOURCE=wheelhouse` input (`COPY wheelhouse/ ...`).

### Phase 2 verification

- `just wheelhouse` builds all wheels into `.wheelhouse/` from a clean checkout.
- `just test-wheelhouse` passes unit and integration tests against the built wheels.
- Unit tests for `scripts/cicd/build_wheelhouse.py` (manifest generation, package ordering, `--py-root` override) pass in CI.

---

## Phase 3: `just dev` and cluster submits via local wheelhouse

*(Independent of Phases 4 and 5; depends on Phase 2.)*

### Goal

Evaluate running `just dev` from the Phase 2 local wheelhouse so local runs, CI wheelhouse tests, and cluster submits share one install path, while keeping editable installs in `python/` for fast unit-test iteration.

### Implementation steps

1. **Benchmark rebuild latency (OQ7):** Measure incremental `just wheelhouse --skip-frontend` time for `backend` + `fiab-core` + plugins on macOS and Linux.
2. **Update `just dev` in root `justfile`:**
   - Default mode (or opt-in flag depending on benchmark result): populate `.wheelhouse/` (rebuilding only packages whose files changed since `manifest.json` or via `uv build`), sync a dedicated dev runtime venv from `--find-links .wheelhouse`, and launch `fiab run` (using `FIAB_ROOT` from [deployment-runtimeAndDockerV3-plan.md](deployment-runtimeAndDockerV3-plan.md)).
   - Keep `just dev editable` (or `--editable`) as an explicit fast-path using the `python/` workspace editable venv if wheel rebuilds add noticeable friction during tight edit-restart loops.
3. **Cluster submit parity:** Document/wire passing the `.wheelhouse/` directory (with `--find-links`) for remote/cluster worker environments so editable-install divergence on remote hosts is eliminated.

### Phase 3 verification

- Measure and record `just dev` cold and warm startup times.
- Verify `just dev` starts cleanly, loads local plugins from the wheelhouse, and `just val` continues to run fast editable unit tests in `python/`.

---

## Phase 4: CD workflow redesign, `fiab-core` locking, and pre-tag Docker v3 gating

*(Depends on Phases 1 and 2, plus `deployment/v3/` from [deployment-runtimeAndDockerV3-plan.md](deployment-runtimeAndDockerV3-plan.md) Phase 4; independent of Phase 3.)*

### Goal

Replace `cd-core.yml`, `cd-plugins.yml`, and `cd-backend.yml` with atomic `cd-major.yml` and single-component `cd-minor-{core,plugins,backend}.yml`, centralize lockfile + constraints generation in Python, and gate every backend/major release on a pre-tag Docker v3 build and smoke test.

### Implementation steps

#### 4.0 `uv` lockfile spike (OQ3)

Before writing the workflows, run a quick local spike verifying:
1. `uv export --format pylock.toml --no-emit-project --no-emit-package fiab-core --no-dev` from `python/backend/` produces a clean PEP 751 `pylock.toml` containing only PyPI-resolvable third-party dependencies (Option B).
2. `uv export --format requirements.txt --no-emit-project --no-emit-package fiab-core --no-dev` produces a clean `constraints.txt` (OQ4).
3. Verify how `uv export` behaves when `fiab-core` is **included** against a local wheelhouse vs PyPI (documenting the exact command/rewrite needed if switching to Option A later).

#### 4.1 Python CI/CD helpers (`scripts/cicd/`)

Replace brittle bash logic in `scripts/cicd/scripts.sh` with focused, unit-tested Python scripts under `scripts/cicd/`:
1. `scripts/cicd/versioning.py`:
   - Computes next major/minor/patch version from git tags (`{v,c,p}` prefixes initially, parameterized for OQ5).
   - Atomically updates `fiab-core>=X,<X+1` dependency constraints and `fallback_version` across all `python/*/pyproject.toml` files (respecting `--py-root`).
2. `scripts/cicd/build_lock.py`:
   - Centralizes `LOCK_EXCLUDED_PACKAGES = ("fiab-core",)` (Option B; single constant to edit for Option A).
   - Generates both `pylock.toml` and `constraints.txt` from `python/backend/` using the verified `uv export` commands from Step 4.0.
   - Under OQ6 Option B, copies `pylock.toml` and a `python-version` file into `python/backend/src/forecastbox/utility/release_metadata/` **before** building the `forecast-in-a-box` wheel so they are bundled as package data (configured in `python/backend/pyproject.toml` `[tool.setuptools.package-data]`, gitignored so dirty trees do not occur in dev).
   - Also writes `install/pylock.toml` and `install/constraints.txt` (kept in sync while `scripts/fiab.sh` remains active).
3. Add pytest unit tests for `scripts/cicd/versioning.py` and `scripts/cicd/build_lock.py`, invoked by `just val-cicd-scripts` and `ci.yml`.

#### 4.2 New CD workflows (`.github/workflows/`)

Confirm release group membership for `fiab-mcp-server` (either bundled in `cd-minor-backend` or `cd-minor-plugins`, or its own minor job if independently versioned).

1. **`.github/workflows/cd-major.yml`** (coordinated breaking release):
   - Inputs: `major_version` (optional; defaults to `current_major + 1`), `prerelease` (bool), `testpypi` (bool).
   - Step 1 -- Version bump: runs `versioning.py` to bump `fiab-core` major version and all dependent constraints across `python/*` in one atomic commit (not pushed yet).
   - Step 2 -- Build wheelhouse + lock: runs `build_lock.py` (generating `pylock.toml` + `constraints.txt` and staging wheel-bundled metadata) and `build_wheelhouse.py` for all packages into `wheelhouse/`.
   - Step 3 -- Verify: runs `test_wheelhouse.py` (backend + core + plugin tests against the wheelhouse).
   - Step 4 -- Pre-tag Docker v3 gate: builds `deployment/v3/Dockerfile` with `INSTALL_SOURCE=wheelhouse` using the candidate `wheelhouse/` and runs the Docker v3 smoke test (empty `FIAB_ROOT` volume startup + `/api/v1/status` + `/api/v1/plugin/list`). Aborts before any publish if this fails.
   - Step 5 -- Publish: uploads all wheels to PyPI (or TestPyPI), commits and pushes the single atomic release commit + tags, creates the GitHub Release (attaching `pylock.toml` and `constraints.txt` as release assets; marked `prerelease` when `prerelease=true`), and pushes the Docker v3 multi-arch images/manifest.
2. **`.github/workflows/cd-minor-core.yml`** (`fiab-core`, `fiab-plugin-test`):
   - Builds candidate wheels for `fiab-core` and `fiab-plugin-test` into a local wheelhouse.
   - Tests them in isolation and against the latest published `forecast-in-a-box` wheel from PyPI (verifying backwards compatibility within the current major).
   - On success, publishes to PyPI and pushes the core tag.
3. **`.github/workflows/cd-minor-plugins.yml`** (`fiab-plugin-ecmwf`, `fiab-plugin-demo`):
   - Builds candidate plugin wheels into a local wheelhouse.
   - Tests them against the published PyPI `fiab-core` (matching what users install).
   - On success, publishes to PyPI and pushes the plugin tag.
4. **`.github/workflows/cd-minor-backend.yml`** (`forecast-in-a-box` + frontend):
   - Runs `build_lock.py` + builds the `forecast-in-a-box` wheel (bundling frontend + `pylock.toml` + `python-version`).
   - Tests the candidate wheel against published PyPI `fiab-core` and `fiab-plugin-test`.
   - Runs the pre-tag Docker v3 build + smoke test against the candidate wheelhouse.
   - On success, uploads to PyPI, commits/pushes lock + tag, creates the GitHub Release (with `pylock.toml` and `constraints.txt` assets), and triggers/pushes the Docker v3 image.
5. Delete legacy `.github/workflows/cd-core.yml`, `cd-plugins.yml`, `cd-backend.yml` once the new workflows are validated via a `testpypi` + `prerelease` dry run.

### Phase 4 verification

- Execute full dry runs of `cd-major`, `cd-minor-core`, `cd-minor-plugins`, and `cd-minor-backend` with `testpypi=true` and `prerelease=true`.
- Confirm a deliberate failure in the Docker v3 smoke test aborts before any PyPI upload or git tag push.
- Confirm the published `forecast-in-a-box` wheel contains `forecastbox/utility/release_metadata/pylock.toml` and `python-version`.

---

## Phase 5: `scripts/fiab.sh` replacement and standalone distribution

*(Depends on Phases 2 and 4, and on the `fiab` CLI + `FIAB_ROOT` from [deployment-runtimeAndDockerV3-plan.md](deployment-runtimeAndDockerV3-plan.md) Phases 1--3; independent of Phase 3.)*

### Goal

Deliver a zero-host-assumption, 100% throwaway standalone installer (`install/install.sh`) and `fiab upgrade [version]` command backed by PyPI-bundled `pylock.toml` (OQ6 Option B), with an overridable install directory (`FIAB_INSTALL_DIR`) and optional `scripts/fiab.sh` stub transition.

### Implementation steps

#### 5.1 Standalone installer (`install/install.sh`)

Create a single, version-agnostic, non-interactive POSIX/bash script `install/install.sh` (hosted at one stable URL, e.g. raw GitHub `main` or an ECMWF static redirect):
1. Accepts optional target version argument and CLI flags / env vars (no installer state file written):
   - `--install-dir <dir>` / `FIAB_INSTALL_DIR` (default TBD by team -- e.g. `${FIAB_ROOT:-$HOME/.fiab}/app` or `${XDG_DATA_HOME:-$HOME/.local/share}/fiab/app`; single constant at top of script)
   - `--bin-dir <dir>` / `FIAB_BIN_DIR` (default `$HOME/.local/bin`)
   - `--no-bin-link` (or `FIAB_BIN_DIR=""`) to skip creating any bin symlink
   - `--prefix <dir>` (shorthand setting `FIAB_INSTALL_DIR=<dir>/app` and `FIAB_BIN_DIR=<dir>/bin`)
   - `FIAB_WHEELHOUSE` (optional local wheelhouse dir for offline/pre-release installs)
   - `FIAB_PIP_INDEX_URL` (optional PyPI mirror)
2. Ensures `uv` is available (uses existing `uv` on `PATH` or installs `uv` into `$FIAB_INSTALL_DIR/uv` without touching `FIAB_ROOT` runtime subdirs).
3. **`fetch_release_metadata(version, tmpdir)`** *(isolated reversibility boundary for OQ6)*:
   - Under Option B: resolves target version (from PyPI JSON API if omitted, or from `FIAB_WHEELHOUSE` manifest), runs `uv pip install --no-deps --target "$tmpdir/pkg" forecast-in-a-box==<ver>` (with `--find-links "$FIAB_WHEELHOUSE" --no-index` when using a wheelhouse), and reads `pylock.toml` and `python-version` from `$tmpdir/pkg/forecastbox/utility/release_metadata/`.
   - *(Rework to Option A/C later only replaces this function with a `curl` from the release URL.)*
4. **`install_into_versioned_venv(version, pylock, py_version)`**:
   - Ensures pinned Python via `uv python install --python-preference only-managed "$py_version"`.
   - Creates `$FIAB_INSTALL_DIR/v<version>/venv` (never touching `FIAB_ROOT/{config,state,share,cache,tmp}`).
   - Installs dependencies from `pylock.toml` and installs `forecast-in-a-box==<version>` (reusing the already-cached wheel from step 3; under Option B also resolves `fiab-core>=X,<X+1` from PyPI/wheelhouse).
   - Atomically swaps symlink `$FIAB_INSTALL_DIR/current -> v<version>`.
   - Unless `--no-bin-link` / empty `FIAB_BIN_DIR`: creates/updates `$FIAB_BIN_DIR/fiab -> $FIAB_INSTALL_DIR/current/venv/bin/fiab`, refusing to overwrite if `$FIAB_BIN_DIR/fiab` already exists and is not a symlink into `$FIAB_INSTALL_DIR`.
   - Prints a clear `PATH` hint if `$FIAB_BIN_DIR` is not on `PATH` (never edits shell rc files).
   - Idempotent on re-run; never reads from stdin; never writes installer metadata files (`install.meta`).

#### 5.2 `fiab upgrade [version]` subcommand

1. Add `upgrade` subcommand to `python/backend/src/forecastbox/entrypoint/cli.py`:
   - Resolves target version (explicit arg or latest non-prerelease from PyPI JSON API `https://pypi.org/pypi/forecast-in-a-box/json`, overridable via `FIAB_PYPI_URL`).
   - Derives `FIAB_INSTALL_DIR` directly from `Path(sys.prefix).parent.parent` (stripping `v<version>/venv`) -- no installer state file required.
   - Downloads and executes the installer from `FIAB_INSTALLER_URL` (defaulting to the single stable `install.sh` URL under Option B; supports a `{version}` template placeholder so switching to Option A/C requires no CLI change), passing `--install-dir "$FIAB_INSTALL_DIR" --no-bin-link` (the user's existing bin symlink already points to `$FIAB_INSTALL_DIR/current/venv/bin/fiab`).
   - Prints clear status and refuses to run when running inside a container/managed deployment (e.g. when `FIAB_MANAGED_DEPLOYMENT=1` or `/etc/fiab/config.toml` sets `allow_self_upgrade = false`).
2. Wire `POST /admin/release` (gated in [deployment-runtimeAndDockerV3-plan.md](deployment-runtimeAndDockerV3-plan.md) Phase 2) to `fiab upgrade` only if desired for standalone installs, keeping it disabled in containers.

#### 5.3 Optional `scripts/fiab.sh` stub transition (decided when Phase 5 is scheduled)

If an automated in-place migration is chosen instead of a clean wipe/cutover:
1. Ship the transition as a **minor** release (so existing `scripts/fiab.sh upgrade` can reach it without `reinstall` wiping `~/.fiab`).
2. Replace `scripts/fiab.sh` with a stub that detects an existing `~/.fiab/venv`, invokes `install.sh` for the same release, moves flat state/config/artifacts into XDG-shaped subdirs (`user.db`/`job.db` -> `state/`, `config.toml` -> `config/`, `data_dir/artifacts` -> `share/artifacts`), removes legacy code artifacts (`venv/`, `uvdir/`, `pylock.toml*`, `release`, `firstrun`), and prints the new `fiab` command.
3. Keep `install/pylock.toml` and `install/config.toml` populated during the transition window, then remove them in the next major release.

### Phase 5 verification

- Test `install/install.sh` on clean Linux and macOS environments (no system Python, no `uv` pre-installed):
  - Fresh install from TestPyPI / PyPI (default dir and custom `--install-dir` / `--bin-dir` / `--no-bin-link`).
  - Pre-release / local install with `FIAB_WHEELHOUSE=.wheelhouse`.
  - Idempotent re-run of `install.sh`, and refusal to overwrite an unrelated `fiab` binary.
  - `fiab upgrade <newer_version>` on a custom `--install-dir` atomically swaps `current` without modifying `FIAB_ROOT` runtime subdirs or recreating unwanted bin symlinks.
- If stub transition is enabled: test upgrading an existing `scripts/fiab.sh` installation and verify `user.db`, `job.db`, `config.toml`, and `artifacts` survive intact.
- Update user/operator/developer docs (`README.md`, `docs/operator/installation.md`, `docs/developer/`, `AGENTS.md`) per `changeSpecs/README.md` step 4.

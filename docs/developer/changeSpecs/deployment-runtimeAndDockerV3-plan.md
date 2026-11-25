# Application runtime model and Docker v3: implementation plan

## Purpose and scope

This plan implements [deployment-runtimeAndDockerV3-design.md](deployment-runtimeAndDockerV3-design.md) across five incremental phases (plus one self-contained, droppable sub-phase for OQ1):

1. **Phase 1:** `FIAB_ROOT` with XDG-shaped storage-class subdirectories (`config/`, `state/`, `share/{artifacts,jobs}`, `cache/`, `tmp/`), 4-layer config loading with shipped defaults and site config, and split storage classes (`StorageSettings`).
   - **Phase 1B (optional / droppable):** Bundle `artifacts.json` and `plugins.json` as package data (OQ1), isolated into standalone commits so it can be skipped or dropped cleanly without affecting any other phase.
2. **Phase 2:** Self-sufficient runtime bootstrap (storage directory init, early earthkit/cache env defaults, package-metadata release identity, gated `POST /admin/release`, state-based first-run detection, and `warmup --plugins` vs immutable runtime plugin controls).
3. **Phase 3:** `fiab` console script (`run`, `service`, `warmup`), `main`/`service` entrypoint alignment, and root `justfile` `dev` simplification.
4. **Phase 4:** Docker v3 prototype (`deployment/v3/`) and empirical validation against Spark, DestinE, EWC, and Linux x86 + NVIDIA GPU to resolve OQ4 and OQ5.
5. **Phase 5:** CI/CD cutover (`.github/workflows/cd-docker.yml`), removal of `deployment/v2/` and `deployment/ewc/`, and documentation updates.

### Prerequisites and cross-plan sequence

This plan assumes **Phase 1 of [ci-repoLayoutAndRelease-plan.md](ci-repoLayoutAndRelease-plan.md) (PR B1: `python/{...}` layout)** lands first, so all backend paths below use `python/backend/` and the workspace root is `python/`.

Combined dependency DAG across both plans (**A** = this plan, **B** = [ci-repoLayoutAndRelease-plan.md](ci-repoLayoutAndRelease-plan.md)):

```text
B1 (repo layout -> python/{...})
 +--> A1 -> A2 -> A3 (FIAB_ROOT, bootstrap, fiab CLI) --+
 +--> B2 (local wheelhouse) ----------------------------+--> A4 (Docker v3 prototype) --> A5 (Docker v3 cutover)
                                                        |         |
                                                        |         v
                                                        +--> B4 (CD workflows + pre-tag Docker gate) --> B5 (install.sh + fiab upgrade)
                                                        +--> B3 (just dev via wheelhouse, optional/independent)
```

Cross-plan synchronization points:
- **B1 first:** Avoids rebasing A1--A4 across the directory move and lets `deployment/v3/Dockerfile` target the final `python/` layout directly.
- **A1--A3 and B2 run in parallel** after B1.
- **A4 (Docker v3 prototype)** needs A3 for the `fiab` CLI / `FIAB_ROOT` runtime, and B2 for the `INSTALL_SOURCE=wheelhouse` build path.
- **B4 (CD workflows)** needs both B2 (wheelhouse) and A4 (`deployment/v3/Dockerfile` for the pre-tag Docker smoke-test gate).
- **B5 (`install.sh` + `fiab upgrade`)** needs A3 (`fiab` CLI + `FIAB_ROOT`) and B4 (wheel-bundled `pylock.toml` + `python-version`).
- **A5 (Docker v3 cutover)** depends on A4 validation (and coordinates with B4 on `cd-docker.yml`).
- **B3 (`just dev` via wheelhouse)** depends only on B2 (best done after A3 so the `justfile` `dev` recipe is already simplified) and is independent of A4, A5, B4, and B5.

Out of scope (explicitly deferred):
- Modifying `scripts/fiab.sh` (must remain working unchanged via `python -m` module entrypoints; optional legacy flat-layout detection is isolated so it can be removed if we opt for a clean wipe instead).
- Switching the default workstation directory from `~/.fiab` to real XDG (`~/.config/fiab`, `~/.local/...`) (OQ7); the code uses XDG-shaped subdirs and per-class resolvers so real XDG defaults can be added cleanly later.
- DB migrations, plugin environment generations, and Kubernetes operator support (Docker v4).

## Decisions for open questions

All open questions from [deployment-runtimeAndDockerV3-design.md](deployment-runtimeAndDockerV3-design.md) are resolved or scheduled as follows:

- **OQ1 (`artifacts.json` / `plugins.json`):** Included as a self-contained, droppable sub-phase (**Phase 1B**) that bundles both files in `forecastbox.utility.defaults` and loads them via a `package://` scheme in `utility/httpx.py`. No other phase depends on Phase 1B, so its commits can be dropped or reverted cleanly at any time.
- **OQ2 (Site-level config):** Single env var `FIAB_SITE_CONFIG` pointing to a TOML file, falling back to `/etc/fiab/config.toml` when unset and present on disk. Define both as module constants `SITE_CONFIG_ENV = "FIAB_SITE_CONFIG"` and `DEFAULT_SITE_CONFIG_PATH = Path("/etc/fiab/config.toml")` in `utility/config.py` so they are trivial to search and replace later.
- **OQ3 (Storage class config keys and env vars):** Add a dedicated `StorageSettings` model at `FIABConfig.storage` (`[storage]` in TOML, `fiab__storage__*` env vars) with four optional fields:
  - `storage.artifacts_path: str | None = None` (`file://` or `ssh://` URL; defaults to `file://<FIAB_ROOT>/share/artifacts`, or `backend.data_path` when explicitly set)
  - `storage.job_data_path: str | None = None` (`file://` or `ssh://` URL; defaults to `file://<FIAB_ROOT>/share/jobs`, or `backend.data_path` when explicitly set)
  - `storage.cache_path: str | None = None` (local filesystem path; defaults to `<FIAB_ROOT>/cache`)
  - `storage.scratch_path: str | None = None` (local filesystem path; fallback for `cascade_logging_base`, defaults to `<FIAB_ROOT>/tmp`)
  All names live in `StorageSettings` and helper methods on `FIABConfig` for easy renaming later.
- **OQ4 (Docker v3 image matrix) & OQ5 (Plugins in Docker v3):** Resolved empirically during Phase 4 by prototyping against Spark, DestinE, EWC, and Linux x86 + NVIDIA GPU before Phase 5 cutover.
- **OQ6 (`fiab` CLI flags):** No existing entrypoint CLI flags to preserve (`main.py`, `bootstrap/service.py`, and `warmup.py` take no flags; the stale `-p` flag in `deployment/v2/Dockerfile-dev` is unused by current `warmup.py`). Expose `fiab run`, `fiab service`, and `fiab warmup [--plugins]`.
- **OQ7 (Workstation layout):** Keep single overridable `FIAB_ROOT` (default `~/.fiab`, `/var/lib/fiab` in Docker) organized into XDG-shaped subdirectories (`config/`, `state/`, `share/{artifacts,jobs}`, `cache/`, `tmp/`). Code stays outside `FIAB_ROOT` in Docker/dev (`/opt/fiab/.venv`, `python/.venv`) and uses `FIAB_INSTALL_DIR` in standalone installs. Real XDG (`~/.config/fiab`, `~/.local/state/fiab`, `~/.local/share/fiab`, `~/.cache/fiab`) remains a 1-to-1 drop-in via the per-class base-dir resolvers.

---

## Phase 1: `FIAB_ROOT`, XDG-shaped layout, config layering, and split storage classes

### Goal

Organize `FIAB_ROOT` into clean, independently mountable XDG-shaped storage-class subdirectories, introduce 4-layer config loading with package-data defaults and site config, and add configurable storage classes while keeping existing `data_path` overrides working.

### Implementation steps

#### 1.1 Dynamic `FIAB_ROOT` and per-class base-dir resolvers (`python/backend/src/forecastbox/utility/config.py`)

1. Add constants and per-class base-directory resolver functions:
   - `FIAB_ROOT_ENV = "FIAB_ROOT"`
   - `SITE_CONFIG_ENV = "FIAB_SITE_CONFIG"`
   - `DEFAULT_SITE_CONFIG_PATH = Path("/etc/fiab/config.toml")`
   - `get_fiab_root() -> Path`: reads `os.environ.get(FIAB_ROOT_ENV)` (expanded via `.expanduser()`), defaulting to `Path.home() / ".fiab"`.
   - Five base-dir resolvers whose internal contents match real XDG 1-to-1 (so adopting real XDG later only changes these five functions):
     - `get_config_dir() -> Path`: `get_fiab_root() / "config"` (user config at `get_config_dir() / "config.toml"`)
     - `get_state_dir() -> Path`: `get_fiab_root() / "state"` (`user.db`, `job.db`)
     - `get_data_dir() -> Path`: `get_fiab_root() / "share"` (`artifacts/`, `jobs/`)
     - `get_cache_dir() -> Path`: `get_fiab_root() / "cache"` (`uv/`, `earthkit-data/`, `cascade-venvs/`)
     - `get_scratch_dir() -> Path`: `get_fiab_root() / "tmp"`
   - `get_user_config_path() -> Path`: returns `get_config_dir() / "config.toml"`.
   - `get_site_config_path() -> Path | None`: returns `Path(os.environ[SITE_CONFIG_ENV])` if set (raise a clear error or log warning if explicitly set to a missing file; validate in `validate_runtime` or at load time), else `DEFAULT_SITE_CONFIG_PATH` if it exists, else `None`.
2. Update `DatabaseSettings` and `BackendSettings` default factories to call the resolvers dynamically instead of capturing a module-import-time `fiab_home` value:
   - `DatabaseSettings.sqlite_userdb_path`: `Field(default_factory=lambda: str(get_state_dir() / "user.db"))`
   - `DatabaseSettings.sqlite_jobdb_path`: `Field(default_factory=lambda: str(get_state_dir() / "job.db"))`
   - `BackendSettings.data_path`: `Field(default_factory=lambda: f"file://{get_data_dir().resolve()}")`
3. Update all internal callers (`entrypoint/bootstrap/service.py`, `domain/admin/__init__.py`, `tests/integration/conftest.py`, `tests/integration/test_db_startup.py`) to use `get_fiab_root()` / `get_state_dir()` so tests no longer need to monkeypatch `forecastbox.utility.config.fiab_home` around eager imports.

#### 1.1b (Optional / removable) Legacy flat `~/.fiab` coexistence detection

*(Isolate this helper and its tests into a dedicated commit so it can be skipped or deleted cleanly if the team decides to wipe existing `~/.fiab` installs on cutover instead of supporting in-place coexistence.)*

1. Add a single helper `_is_legacy_flat_root(root: Path) -> bool` in `python/backend/src/forecastbox/utility/config.py`:
   - Returns `True` if `os.environ.get("FIAB_RELEASE_MARKER")` is set (invoked by legacy `scripts/fiab.sh`), OR if `(root / "state").exists()` is `False` and any of `root / "job.db"`, `root / "user.db"`, or `root / "config.toml"` exists directly at top level.
2. When `_is_legacy_flat_root(root)` is `True`:
   - `get_config_dir()` and `get_state_dir()` return `root`.
   - `get_data_dir()` returns `root / "data_dir"`.
3. Deleting `_is_legacy_flat_root` and its 3-line branch in those resolvers cleanly removes all legacy flat-layout code without affecting any other part of the plan.

#### 1.2 Shipped default config as package data

1. Add `python/backend/src/forecastbox/utility/defaults/__init__.py` (empty) and `python/backend/src/forecastbox/utility/defaults/config.toml` (initially mirroring `install/config.toml` -- empty/commented defaults, since Pydantic model defaults hold the baseline values, ready for profile/version overrides).
2. In `python/backend/pyproject.toml`, configure `[tool.setuptools.package-data]` so `forecastbox = ["utility/defaults/*.toml"]` (and ensure `just fiabwheel`'s `MANIFEST.in` generation does not exclude package data).
3. Load the shipped TOML via `importlib.resources.files("forecastbox.utility.defaults").joinpath("config.toml")` (using `importlib.resources.as_file` or a small custom `PydanticBaseSettingsSource` reading TOML from text so it works whether installed as wheel or editable).

#### 1.3 Four-layer `FIABConfig.settings_customise_sources`

Update `FIABConfig.settings_customise_sources` so precedence from highest to lowest is:
1. `env_settings` (`fiab__*`)
2. `file_secret_settings`
3. `dotenv_settings`
4. User config: `TomlConfigSettingsSource(settings_cls, get_user_config_path())`
5. Site config (when `get_site_config_path()` is not `None`): `TomlConfigSettingsSource(settings_cls, site_path)`
6. Shipped defaults: `TomlConfigSettingsSource` / text-based TOML source from `forecastbox.utility.defaults/config.toml`
7. `init_settings`

Keep the `FIAB_IGNORE_CONFIG_SOURCES=1` bypass returning `(env_settings, init_settings)` for tests.
Update `FIABConfig.save_to_file()` to write to `get_user_config_path()`.

#### 1.4 Split storage classes (`StorageSettings`)

1. Add `StorageSettings(FiabBaseModel)` in `python/backend/src/forecastbox/utility/config.py`:
   ```python
   class StorageSettings(FiabBaseModel):
       artifacts_path: str | None = None
       """URL for immutable model artifacts (file:// or ssh://). Falls back to backend.data_path when unset."""
       job_data_path: str | None = None
       """URL for mutable job inputs and outputs (file:// or ssh://). Falls back to backend.data_path when unset."""
       cache_path: str | None = None
       """Local directory for rebuildable caches and task venvs (earthkit, uv, cascade)."""
       scratch_path: str | None = None
       """Local directory for short-lived run logs and temporary files."""
   ```
   Add `storage: StorageSettings = Field(default_factory=StorageSettings)` to `FIABConfig` (and expose it in `routes/admin.py` `ExposedSettings` only if appropriate -- prefer keeping `storage` operator-configured, not mutable via web UI, unless requested).
2. Add resolution helpers on `FIABConfig`:
   - `effective_artifacts_path(self) -> str`: returns `self.storage.artifacts_path or self.backend.data_path`.
   - `effective_job_data_path(self) -> str`: returns `self.storage.job_data_path or self.backend.data_path`.
   - `effective_scratch_path(self) -> str | None`: returns `getattr(self.cascade.gateway, "startup_params", None).cascade_logging_base` if set, else `self.storage.scratch_path`.
3. Update `validate_runtime` across `StorageSettings`, `BackendSettings`, and `FIABConfig`:
   - Validate URL scheme (`file://` or `ssh://`) and local directory existence for `effective_artifacts_path()` and `effective_job_data_path()`.
   - Validate `cache_path` and `scratch_path` are existing directories when set.
   - Check `(cascade.scheme, url.scheme)` and `ssh://` netloc compatibility for both `effective_artifacts_path()` and `effective_job_data_path()` (preserving existing error semantics when only `backend.data_path` is set).
4. Wire storage helpers into callers:
   - `python/backend/src/forecastbox/domain/artifact/manager.py`: replace `config.backend.data_path` with `config.effective_artifacts_path()`.
   - `python/backend/src/forecastbox/entrypoint/initializers.py`: register `ArtifactsProvider.register_get_artifact_local_path` using `config.effective_artifacts_path()`.
   - `python/backend/src/forecastbox/entrypoint/bootstrap/config.py` (`init_logging_base`) and `python/backend/src/forecastbox/domain/gateway/service.py`: use `config.effective_scratch_path()` when `cascade_logging_base` is unset.
   - Note on `artifacts_subdir`: keep the existing `<artifacts_path>/artifacts/<store_id>/<artifact_id>` layout in `domain/artifact/base.py` and `domain/artifact/io.py` so `effective_artifacts_path()` is a drop-in replacement for `data_path` with no on-disk migration.

### Phase 1 verification

- Add `python/backend/tests/unit/utility/test_config.py` covering:
  - `get_fiab_root()` and per-class base-dir resolvers (`config/`, `state/`, `share/`, `cache/`, `tmp/`).
  - (In the optional 1.1b commit) `_is_legacy_flat_root()` detection for flat `~/.fiab` and `FIAB_RELEASE_MARKER`.
  - 4-layer config precedence (env > user > site > shipped default) and `FIAB_SITE_CONFIG`.
  - `StorageSettings` fallbacks (`effective_artifacts_path`, `effective_job_data_path`, `effective_scratch_path`) and `validate_runtime` checks for valid/invalid `file://` and `ssh://` URLs.
- Run `uv run ty check` and `uv run pytest tests/unit/utility/test_config.py tests/unit/test_artifacts.py`.

---

## Phase 1B (optional / droppable): Bundle `artifacts.json` and `plugins.json` as package data (OQ1)

### Goal

Decouple default artifact and plugin catalogs from raw GitHub URLs (`refs/tags/${TAG}/install/artifacts.json` and `refs/heads/main/install/plugins.json`) by shipping them as package data alongside `config.toml`, while isolating the change into two standalone commits so it can be cleanly dropped from history or reverted without touching Phases 1--5.

### Isolation and drop-safety rules

- Do **not** mix any Phase 1B edits into Phase 1 or Phase 2 commits.
- Do **not** remove `method="gittag"` from `ArtifactStoreConfig` or `domain/artifact/catalog.py` (existing user configs using `gittag` stay valid, and dropping Phase 1B requires zero code restoration there).
- Do **not** delete `install/artifacts.json` or `install/plugins.json` yet, because already-released backends still fetch `refs/heads/main/install/plugins.json` and `.github/workflows/cd-artifacts_update.yml` / `docs/developer/guidelines/example_dev_config.toml` still reference `install/artifacts.json`. Keep `install/` synced (or retire it only in a later major release after Phase 1B is confirmed permanent).

### Implementation steps (2 isolated commits)

#### Commit 1B-1: Add `package://` resource scheme and bundle catalog JSONs

1. In `python/backend/src/forecastbox/utility/httpx.py` (`fetch_content`):
   - Add support for `package://<module>/<resource>` URLs using `importlib.resources.files(module).joinpath(resource).read_bytes()` (e.g. `package://forecastbox.utility.defaults/artifacts.json`).
   - Keep `http://`, `https://`, and `file://` behavior unchanged.
2. Place `artifacts.json` and `plugins.json` under `python/backend/src/forecastbox/utility/defaults/` (copied from `install/artifacts.json` and `install/plugins.json`).
3. Update `python/backend/pyproject.toml` `[tool.setuptools.package-data]` to include `"utility/defaults/*.json"` alongside `"utility/defaults/*.toml"`.
4. Add unit tests for `package://` resolution in `python/backend/tests/unit/utility/test_httpx.py` (valid resource, missing resource, invalid package path).

#### Commit 1B-2: Point default artifact and plugin stores at package data

1. In `python/backend/src/forecastbox/utility/config.py`:
   - Update `_default_artifact_stores()` to:
     ```python
     ArtifactStoreConfig(url="package://forecastbox.utility.defaults/artifacts.json", method="file")
     ```
   - Update `_default_plugin_stores()` to:
     ```python
     PluginStoreConfig(url="package://forecastbox.utility.defaults/plugins.json", method="file")
     ```
2. Update any tests asserting the default store URLs (`python/backend/tests/unit/utility/test_config.py`) and verify offline/air-gapped catalog loading works without hitting GitHub.
3. **Note on `cd-artifacts_update.yml`:** Once Phase 1B is accepted permanently, out-of-band artifact catalog updates will either be shipped as a `cd-minor-backend` patch release (updating `utility/defaults/artifacts.json`) or supplemented by an external mirror URL in site/user config; `.github/workflows/cd-artifacts_update.yml` is left untouched during Phase 1B so dropping Commits 1B-1 and 1B-2 restores the exact previous workflow.

### Phase 1B verification

- `uv run pytest tests/unit/utility/test_httpx.py tests/unit/utility/test_config.py tests/unit/test_artifacts.py`.
- Verify `get_artifacts_catalog(config.external.artifact_stores)` and `fetch_store(client, config.external.plugin_stores["ecmwf"])` succeed with no network access.
- Verify `git revert` / dropping Commits 1B-1 and 1B-2 produces zero conflicts with Phases 2--5.

---

## Phase 2: Self-sufficient runtime bootstrap, release identity, and warmup/first-run split

### Goal

Move all runtime bootstrap currently duplicated across `scripts/fiab.sh`, root `justfile`, `deployment/v2`, and `deployment/ewc/docker-entrypoint.sh` into Python, cleanly separate Code warmup from State initialization, and remove hard dependencies on `FIAB_RELEASE_MARKER`, `FIAB_FIRSTRUN`, and `pylock.toml.timestamp`.

### Implementation steps

#### 2.1 Early environment defaults (`python/backend/src/forecastbox/entrypoint/bootstrap/env.py`)

1. Create a lightweight, zero-heavy-import module `python/backend/src/forecastbox/entrypoint/bootstrap/env.py` with `apply_env_defaults(cache_path: str | None = None) -> None`:
   - `os.environ.setdefault("EARTHKIT_DATA_CACHE_POLICY", "user")`
   - `os.environ.setdefault("EARTHKIT_DATA_MAXIMUM_CACHE_SIZE", "50G")`
   - When `cache_path` is provided:
     - `cache_root = Path(cache_path)`
     - `os.environ.setdefault("EARTHKIT_DATA_USER_CACHE_DIRECTORY", str(cache_root / "earthkit-data"))`
     - `os.environ.setdefault("CASCADE_VENV_ROOT", str(cache_root / "cascade-venvs"))`
     - `os.environ.setdefault("UV_CACHE_DIR", str(cache_root / "uv"))`
2. Remove the top-level `import earthkit.data as ekd` from `python/backend/src/forecastbox/entrypoint/main.py`! Import `earthkit.data` inside `launch_all` (with an explanatory comment per `python/backend/development.md`) **only after** `apply_env_defaults(...)` has run, so `earthkit.data` reads the defaulted env vars at import time.
3. Also invoke `apply_env_defaults(config.storage.cache_path)` in `entrypoint/bootstrap/launchers.py` (`launch_backend`), `entrypoint/bootstrap/service.py`, and `entrypoint/warmup.py` before any `earthkit` import.

#### 2.2 Automatic storage directory initialization (`python/backend/src/forecastbox/entrypoint/bootstrap/storage.py`)

1. Create `ensure_storage_dirs(config: FIABConfig) -> None` that creates local directories if missing:
   - `get_fiab_root()`, `get_config_dir()`, `get_state_dir()`
   - `Path(config.db.sqlite_userdb_path).parent`
   - `Path(config.db.sqlite_jobdb_path).parent`
   - For each of `config.effective_artifacts_path()` and `config.effective_job_data_path()`: if scheme is `file`, `Path(parsed.path).mkdir(parents=True, exist_ok=True)`.
   - If `config.storage.cache_path` is set (or default `get_cache_dir()`): create the cache directory and its subdirs (`earthkit-data`, `cascade-venvs`, `uv`).
   - If `config.effective_scratch_path()` is set (or default `get_scratch_dir()`): create that directory.
2. Call `ensure_storage_dirs(config)` **before** `validate_runtime(config)` in `entrypoint/main.py`, `entrypoint/bootstrap/service.py`, and full `entrypoint/warmup.py` (never in `warmup --plugins`, which must not touch `FIAB_ROOT`).

#### 2.3 Release identity from package metadata and `POST /admin/release` gating

1. Update `python/backend/src/forecastbox/domain/admin/__init__.py`:
   - Replace the `pylock.toml.timestamp`-only `get_local_release()` with package metadata lookup:
     - Read version via `importlib.metadata.version("forecast-in-a-box")` (falling back to `forecastbox._version.__version__` if metadata is unavailable in unusual dev layouts) and parse with `Release.from_string(...)`.
     - For `local_release_age_days` / timestamp: if `pylock.toml.timestamp` exists in `get_fiab_root()` and parses cleanly, return its timestamp for backwards compatibility; otherwise return `None` (or package dist mtime / `0` days -- check `GetReleaseStatusResponse.local_release_age_days: int` so the API schema does not break; returning `0` or dist mtime keeps `int` compatible with existing clients).
   - Remove the hard requirement on `FIAB_RELEASE_MARKER` and `FIAB_FIRSTRUN` from `Globals`.
   - Keep `get_most_recent_release()` read-only (optional follow-up: switch from GitHub API to PyPI JSON API `https://pypi.org/pypi/forecast-in-a-box/json` to avoid unauthenticated GitHub rate limits; keep `get_most_recent_release()` behavior well-tested).
2. Gate `POST /admin/release` in `python/backend/src/forecastbox/routes/admin.py`:
   - Keep the route signature and `UpdateReleaseResponse` intact for `#187`.
   - Return `HTTPException(status_code=501, detail="In-app release updates are disabled; use your deployment tool or `fiab.sh upgrade` to upgrade.")` instead of mutating `pylock.toml` and `FIAB_RELEASE_MARKER` in place.
   - Remove unused `mark_release`, `save_pylock`, `get_pylock` calls from `routes/admin.py` (keep or clean up `domain/admin/__init__.py` helpers and update `python/backend/tests/unit/test_updates.py` accordingly).

#### 2.4 State-based first-run detection, `warmup --plugins`, and immutable plugin mode

1. Add `allow_runtime_plugin_install: bool = True` to `BackendSettings` in `python/backend/src/forecastbox/utility/config.py`:
   - Defaults to `True` (standalone venvs, `just dev`, `scripts/fiab.sh`).
   - Deployers running immutable containers (Docker v3 with baked plugins) set `backend.allow_runtime_plugin_install = false` (e.g. in `/etc/fiab/config.toml` or env var `fiab__backend__allow_runtime_plugin_install=false`).
2. Guard runtime plugin mutations when `not config.backend.allow_runtime_plugin_install`:
   - In `python/backend/src/forecastbox/routes/plugins.py`: `POST /plugin/install`, `POST /plugin/uninstall`, and `POST /plugin/update` return `HTTPException(status_code=403, detail="Runtime plugin installation is disabled in this deployment")`.
   - In `python/backend/src/forecastbox/domain/plugin/loading.py` (`load_plugins`): skip `install_plugin_compatibly(...)` for both `update_strategy == "auto"` and missing-module fallback; if a persisted plugin module is not importable, record a `PluginError(source="load", ...)` without invoking pip.
3. Replace `FIAB_FIRSTRUN`-driven detection with state-based detection:
   - Define `is_first_run(config: FIABConfig) -> bool`:
     - If `os.environ.get("FIAB_FIRSTRUN") == "false"` (explicitly set by legacy `scripts/fiab.sh` on subsequent runs): return `False`.
     - Otherwise, check whether `Path(config.db.sqlite_jobdb_path).exists()` (evaluated **before** the backend process starts and runs `start_db_schema()`). If `job.db` does not exist yet, it is a first run!
   - Wait: handle the two first-run modes cleanly:
     - When `allow_runtime_plugin_install` is `True`: `entrypoint/main.py` calls `install_default_plugins(config)` (as today) after backend readiness.
     - When `allow_runtime_plugin_install` is `False` (immutable container starting with an empty mounted `FIAB_ROOT`): seed pre-installed `default_plugins` into the fresh `job.db` **without** invoking pip (resolve from `plugin_stores`, call `update_single(plugin_id, settings, install=False, version=None)`, and apply `default_plugins_settings`), either inside the backend's startup when `plugin_state` is empty on a fresh DB or via a dedicated helper in `entrypoint/initializers.py` / `domain/plugin/loading.py`. Running this inside backend initialization (when `not allow_runtime_plugin_install` and `plugin_state` table is empty) works identically for both `fiab run` and `fiab service`!
4. Split `python/backend/src/forecastbox/entrypoint/warmup.py`:
   - Add `warmup(plugins_only: bool = False) -> None`:
     - When `plugins_only=True` (invoked by `fiab warmup --plugins` during Docker image build):
       - Runs `setup_process()` and `apply_env_defaults(config.storage.cache_path)`.
       - Does **not** call `ensure_storage_dirs`, `start_db_schema`, or `validate_runtime` on `FIAB_ROOT` DB/data paths.
       - Starts HTTP pools, initializes `plugin_stores`, runs `check_environment_baseline()`, resolves each `default_plugin`, and calls `install_plugin_compatibly(settings.pip_source, None, settings.module_name)` sequentially into the active venv.
       - Exits non-zero if any plugin fails to install.
     - When `plugins_only=False` (default, invoked by `fiab warmup` and legacy `python -m forecastbox.entrypoint.warmup` from `scripts/fiab.sh`):
       - Preserves existing behavior: `ensure_storage_dirs`, `validate_runtime`, `start_db_schema`, `refresh_catalog`, `initialize_stores`, `_install_plugins` (install + DB upsert + `default_plugins_settings`).
   - Note: `warmup.py` can drop its `fire` dependency in `if __name__ == "__main__"` and delegate to the shared CLI parser or `argparse` (check if `fire` is used anywhere else before removing from `pyproject.toml`; do not remove `fire` from `pyproject.toml` if other modules use it).

### Phase 2 verification

- Update `python/backend/tests/unit/test_updates.py` for package-metadata `get_local_release()` and gated `POST /admin/release`.
- Add unit tests for:
  - `apply_env_defaults` (defaults set, explicit env vars preserved, `cache_path` wiring).
  - `ensure_storage_dirs` (creates missing dirs, skips `ssh://` URLs).
  - `is_first_run` (empty `FIAB_ROOT` vs existing `job.db` vs `FIAB_FIRSTRUN="false"`).
  - `allow_runtime_plugin_install=False` (HTTP routes return 403, `load_plugins` does not invoke pip, fresh DB seeds pre-installed `default_plugins` with `install=False`).
  - `warmup(plugins_only=True)` does not create `FIAB_ROOT` or `job.db`.
- Update `python/backend/tests/integration/conftest.py` (remove manual `pylock.toml.timestamp` seeding and `fiab_home` monkeypatch) and run `uv run pytest tests/integration/test_db_startup.py`.

---

## Phase 3: `fiab` console script and `just dev` simplification

### Goal

Expose a single `fiab` console script from `forecast-in-a-box`, align `main` and `service` lifecycle handling, preserve `python -m` module paths for `scripts/fiab.sh`, and simplify `just dev`.

### Implementation steps

#### 3.1 `fiab` console script (`python/backend/src/forecastbox/entrypoint/cli.py`)

1. Create `python/backend/src/forecastbox/entrypoint/cli.py` using stdlib `argparse` (keep top-level imports minimal -- no `earthkit`, `fastapi`, or `uvicorn` at module import time):
   - `fiab run` -> calls `forecastbox.entrypoint.main.run_main()`
   - `fiab service` -> calls `forecastbox.entrypoint.bootstrap.service.run_service()`
   - `fiab warmup [--plugins]` -> calls `forecastbox.entrypoint.warmup.warmup(plugins_only=args.plugins)`
2. Register the console script in `python/backend/pyproject.toml`:
   ```toml
   [project.scripts]
   fiab = "forecastbox.entrypoint.cli:main"
   ```
3. Refactor `entrypoint/main.py` and `entrypoint/bootstrap/service.py` so their `if __name__ == "__main__":` blocks call `run_main()` and `run_service()` respectively:
   - Add SIGTERM/KeyboardInterrupt handling and `handles.wait()` to `run_service()` (currently missing, noted by TODO in `service.py`) so `fiab service` works cleanly as PID 1 in containers and under systemd.
   - Keep `python -m forecastbox.entrypoint.main`, `python -m forecastbox.entrypoint.warmup`, and `python -m forecastbox.entrypoint.bootstrap.service` working identically for `scripts/fiab.sh`.

#### 3.2 Simplify root `justfile` `dev` recipe

Update the `dev` recipe in `justfile`:
1. Remove `FIAB_FIRSTRUN_MARKER`, `FIAB_FIRSTRUN` export/touch, `mkdir -p .fiab/data_dir`, fake `echo "1761908420:d0.0.1" > .fiab/pylock.toml.timestamp`, and `EARTHKIT_DATA_CACHE_*` exports.
2. Set `export FIAB_ROOT="${FIAB_ROOT:-.fiab}"` inside `{{py_root}}/backend/`.
3. Keep copying `../../docs/developer/guidelines/example_dev_config.toml` to `"${FIAB_ROOT}/config/config.toml"` if missing (dev-only local editable plugin store wiring), creating `"${FIAB_ROOT}/config"` only for that copy.
4. Keep `just dev reinstall` dropping `${FIAB_ROOT}/state/*.db` (and `${FIAB_ROOT}/*.db` if legacy) and running `uv sync --extra runtime --all-packages` from `{{py_root}}/`.
5. Replace `uv run --no-sync python -m forecastbox.entrypoint.main` with `uv run --no-sync fiab run`.

### Phase 3 verification

- Run `uv sync` in `python/` and verify `uv run fiab --help`, `uv run fiab run --help`, `uv run fiab service --help`, `uv run fiab warmup --help`.
- Verify `python -m forecastbox.entrypoint.warmup --help` (and `main`, `bootstrap.service` imports) remain intact.
- Smoke-test `just dev` (fresh `.fiab` and restart on existing `.fiab`).
- Run `just val` and `uv run prek`.

---

## Phase 4: Docker v3 prototype and empirical validation (OQ4 & OQ5)

### Goal

Build a working Docker v3 setup in `deployment/v3/` using the new `fiab` CLI, `FIAB_ROOT`, and site config, and validate it across target environments to settle OQ4 (image matrix) and OQ5 (plugin strategy) empirically.

### Implementation steps

#### 4.1 Create `deployment/v3/` structure

Create:
- `deployment/v3/Dockerfile` (single multi-stage Dockerfile, parameterized by `ARG BASE_IMAGE=debian:stable-slim` so a CUDA/Spark variant can be built from the same file without diverging):
  - **`base` stage:** `FROM ${BASE_IMAGE}` (default `debian:stable-slim`, or an NVIDIA CUDA toolkit base for GPU/Spark), OS libs (`bash`, `curl`, `ca-certificates`, `libgfortran5`, `libgomp1`, `libquadmath0` on `amd64`, `gdal-bin`, `libgdal-dev`, `g++`, `libglib2.0-0t64`, `libudunits2-dev`), `uv` binary, pinned Python via `uv python install`, non-root user `fiab`, `/opt/fiab` owned by `fiab`, default `ENV FIAB_ROOT=/var/lib/fiab` and `ENV UDUNITS2_XML_PATH=/usr/share/xml/udunits/udunits2.xml`.
  - **Container site config (`/etc/fiab/config.toml`):** baked into the image with container defaults (`backend.launch_browser = false`, `backend.allow_service = true` or `false` matching `CMD`, `backend.allow_runtime_plugin_install = false` when plugins are baked). Users/deployers override via mounted `FIAB_ROOT/config/config.toml` or `fiab__*` env vars.
  - **`release` stage:**
    - Supports two install sources via build args:
      - `INSTALL_SOURCE=pypi` + `RELEASE_TAG=vX.Y.Z`: installs `pylock.toml` + `forecast-in-a-box==X.Y.Z` into `/opt/fiab/.venv`.
      - `INSTALL_SOURCE=wheelhouse` (`COPY wheelhouse/ /tmp/wheelhouse/`): installs from local wheelhouse + lock into `/opt/fiab/.venv` so CI and unreleased branches test the exact same image structure.
    - Optional plugin bake step (`ARG BAKE_PLUGINS=true`): runs `/opt/fiab/.venv/bin/fiab warmup --plugins` against `/opt/fiab/.venv` without touching `/var/lib/fiab`.
    - Sets `USER fiab`, `VOLUME ["/var/lib/fiab"]`, `ENTRYPOINT ["/opt/fiab/.venv/bin/fiab"]`, `CMD ["run"]` (or `["service"]` depending on `allow_service` -- prefer `CMD ["run"]` with `launch_browser=false` in `/etc/fiab/config.toml` so no `allow_service` pidfile check is needed, and `fiab run` owns SIGTERM propagation cleanly).
  - **`dev` stage:** extends `base`/`release` with `/opt/fiab/.venv` inside the container, installs workspace dependencies from `python/pyproject.toml` and `python/uv.lock` (plus `python/*/pyproject.toml`), and supports editable bind-mount of host source tree without ever bind-mounting host `python/.venv`.
- `deployment/v3/justfile`: recipes for `build-release`, `build-wheelhouse`, `build-dev`, `run`, and a smoke test that starts the container with an empty mounted `FIAB_ROOT` volume and checks `/api/v1/status` and `/api/v1/plugin/list`.
- `deployment/v3/docker-compose.yml`: example compose showing both single-volume `FIAB_ROOT` mounting and per-subdir mounts inside `FIAB_ROOT` (`share/artifacts:ro`, `share/jobs`, `state`, `cache`), plus optional unmanaged Cascade container (covering EWC pattern).
- `deployment/v3/README.md`: build/run instructions and env var reference.

#### 4.2 Empirical validation matrix (settling OQ4 & OQ5)

Test the prototype against the four target environments and record findings before Phase 5:
1. **Standard Linux x86 + NVIDIA GPU & NVIDIA DGX Spark (`arm64`):** Check whether host NVIDIA Container Toolkit (`--gpus all`) + PyPI CUDA wheels work on `debian:stable-slim`, or whether a CUDA toolkit `BASE_IMAGE` variant is needed (**OQ4**). In particular, previous Spark runs required:
   - `UV_EXTRA_INDEX_URL=https://download.pytorch.org/whl/cu130`
   - `UV_INDEX_STRATEGY=unsafe-best-match`
   - `TRITON_PTXAS_PATH=/usr/local/cuda/bin/ptxas`
   Since `ptxas` is not present in `debian:stable-slim` and is not injected by `--gpus all`, verify whether a CUDA toolkit base image (with these env vars set in the GPU/Spark variant) is required for Spark and/or x86 GPU.
2. **Spark / DestinE:** Verify non-root UID mapping, read-only shared `FIAB_ROOT/share/artifacts` (or `storage.artifacts_path`), exec-able `FIAB_ROOT/cache` (`CASCADE_VENV_ROOT`), and startup with an empty `FIAB_ROOT` volume.
3. **EWC (MARS + separate Cascade container):** Verify `cascade.gateway.gateway_type = "unmanaged"` with separate Cascade service and whether MARS client libs belong in the Cascade image or a thin EWC `FROM` layer.
4. **Plugin strategy (OQ5):** Compare baked plugins (`fiab warmup --plugins` + `allow_runtime_plugin_install=false`) vs mounted/runtime plugins on restart and image upgrade, and confirm fresh-volume template ingestion works cleanly.

---

## Phase 5: Cutover, CI/CD update, and cleanup

### Goal

Promote Docker v3 to the single supported container deployment and remove legacy v2/ewc setups.

### Implementation steps

1. **CI/CD (`.github/workflows/cd-docker.yml`):**
   - Switch `working-directory` from `deployment/v2` to `deployment/v3` and invoke the v3 build target(s) (incorporating the OQ4 decision on CPU vs GPU image matrix).
   - Add a container smoke-test step in CI (or workflow_dispatch) using the `wheelhouse` build path before pushing.
2. **Delete legacy deployments:**
   - Remove `deployment/v2/` and `deployment/ewc/` once v3 is verified in CI and target environments.
3. **Documentation updates (step 4 of `changeSpecs/README.md`):**
   - Update `docs/operator/installation.md` and `docs/operator/tuningAndConfiguration.md` to document `fiab` CLI, `FIAB_ROOT` XDG-shaped layout, site config (`FIAB_SITE_CONFIG` / `/etc/fiab/config.toml`), `StorageSettings`, and Docker v3.
   - Update `python/backend/development.md` and `AGENTS.md` if runtime/dev commands changed.
   - Update `docs/developer/changeSpecs/deployment-runtimeAndDockerV3-design.md` status or retire changeSpec docs once complete.

# Repository layout, release pipeline, and pre-release testing: design

## Status

Proposal (step 1 of the [changeSpecs workflow](README.md)), open for feedback.

- Supersedes the *Release Scenario* of [ci-fiab_core.md](ci-fiab_core.md) (reversing its conclusion that the repository stays organized as-is) and revisits its *Install Scenario* with respect to `fiab-core` locking. The *Migration Scenario* in [ci-fiab_core.md](ci-fiab_core.md) (blueprint version warnings) is unaffected.
- Supersedes the installer/launcher split originally proposed in [#169](https://github.com/ecmwf/forecast-in-a-box/issues/169); the explicit `upgrade`/`reinstall` commands delivered in [#757](https://github.com/ecmwf/forecast-in-a-box/pull/757) remain valid until the Phase 5 transition.
- Companion to [deployment-runtimeAndDockerV3-design.md](deployment-runtimeAndDockerV3-design.md), which covers the Python runtime bootstrap, `FIAB_HOME`/storage classes, and the initial Docker v3 image and can proceed in parallel.
- Organized into work packages with explicit dependencies rather than a strict linear chain (see [Dependencies and ordering](#dependencies-and-ordering)).

## Context

### Current state

The repository is structured as a single `uv` workspace rooted at `backend/`, with `backend/packages/{fiab-core, fiab-plugin-ecmwf, fiab-plugin-demo, fiab-plugin-test, fiab-mcp-server}` declared as workspace members.

- **CI (`ci.yml`) and `just dev`** run inside the workspace with editable installs of all packages, testing that the current commit is mutually consistent.
- **CD (`cd-core.yml`, `cd-plugins.yml`, `cd-backend.yml`, `cd-docker.yml`)** tries to treat each package as isolated by setting `UV_NO_PROJECT=1` and installing sibling packages from PyPI.
- **`fiab-core` is excluded from `install/pylock.toml`**, so installations resolve `fiab-core>=X,<X+1` at install time rather than pinning the exact version tested.
- **`scripts/fiab.sh`** queries the GitHub Releases API for the latest tag, downloads `install/pylock.toml`, `install/config.toml`, and `scripts/fiab.sh` from `refs/tags/<tag>/`, and installs the wheel from PyPI.

### Observed problems

1. **Workspace vs. isolated CD mismatch.** `just dev` and CI treat the repo as a unified monorepo workspace, while CD pretends packages are isolated using `UV_NO_PROJECT=1`. This makes CD scripts brittle and causes CI and CD to test different dependency graphs.
2. **Broken repository window during releases.** Between the completion of `cd-core` and `cd-backend`, the repository is broken by design and `just dev` fails.
3. **Unreliable releases and late failure discovery.** Release workflows have repeatedly failed mid-release. Release-only steps (such as Docker image build and `warmup`) run for the first time after a release tag is already pushed and PyPI artifacts are published.
4. **No pre-release testing path.** Unreleased branches cannot be installed or tested end-to-end through the same paths users use, and `scripts/fiab.sh`'s dependence on GitHub release pages makes pre-release testing hacky.
5. **Non-reproducible installations.** Because `fiab-core` is omitted from `pylock.toml`, two installations of the same `forecast-in-a-box` release can resolve different `fiab-core` versions.
6. **Fragile CI/CD shell testing.** The current bash scripts and unit-testing setup in `scripts/cicd/` are hard to maintain and insufficient to catch release failures.

### Release support policy

- The intended public support policy is to **actively support the latest release**; older branches are supported only by explicit agreement with specific stakeholders.
- The goal of locking and reproducibility is **deterministic installations** (allowing the team to recreate user environments and test upgrades/downgrades), not maintaining independent security patches across every historical release.

## Goals

- **G1** A repository layout that cleanly supports all three modes at once:
  1. workspace unit tests with editable installs of all components;
  2. production-like backend execution;
  3. isolated testing and building of every package without `UV_NO_PROJECT=1` workarounds.
- **G2** Atomic, reliable CD workflows (`cd-major` and `cd-minor-{component}`) that never leave the repository in a broken state.
- **G3** Deterministic, reproducible installations with an explicit, consistent `fiab-core` locking and plugin compatibility contract.
- **G4** End-to-end pre-release testing from any branch via a local wheelhouse, including gating releases on pre-tag Docker v3 builds and smoke tests.
- **G5** Shared local-wheelhouse tooling evaluated for `just dev` and cluster submits.
- **G6** Decouple `scripts/fiab.sh` from fragile GitHub release-page assumptions while preserving its product requirements.

## Non-goals

- Runtime bootstrap consolidation, `FIAB_HOME`/storage classes, and initial Docker v3 prototyping (covered in [deployment-runtimeAndDockerV3-design.md](deployment-runtimeAndDockerV3-design.md)).
- Task-level environment merging, plugin dependency constraint audits, and checkpoint compatibility matrices (separate parallel workstreams).
- Multi-user version managers or side-by-side state lifecycle policies.

## Dependencies and ordering

The five phases form a small DAG in topological order:

- **Phase 1 (repo layout)** goes first. Making packages standalone removes `UV_NO_PROJECT=1` workarounds and avoids rework in every downstream phase.
- **Phase 2 (local wheelhouse & pre-release testing)** builds on Phase 1 and provides the wheelhouse tooling consumed by both Phase 3 and Phase 4.
- **Phase 3 (`just dev` & cluster submits via wheelhouse)** depends on Phase 2 (reusing its wheelhouse tooling) and is independent of Phases 4 and 5.
- **Phase 4 (CD workflows, `fiab-core` locking, & pre-tag Docker v3 gating)** depends on Phase 2 (`cd-major` and pre-tag Docker gating consume the wheelhouse) and is independent of Phase 3.
- **Phase 5 (`scripts/fiab.sh` replacement & standalone distribution)** depends on Phase 4 (published lock/assets) and Phase 2 (wheelhouse/pre-release format), and is independent of Phase 3.

Summary: `1 -> 2 -> 4 -> 5`, with `1 -> 2 -> 3` as an independent branch after Phase 2.

## Phase 1: Repository layout restructure

This is the prerequisite for every subsequent phase because CI/CD complexity stems directly from the current workspace nesting.

### Proposed structure

- Move the packages out of `backend/packages/` into standalone sibling packages (for example `backend/`, `fiab-core/`, `fiab-plugin-ecmwf/`, `fiab-plugin-demo/`, `fiab-plugin-test/`, `fiab-mcp-server/`, or grouped under a common `python/` directory).
- Each package has its own standalone `pyproject.toml` and is **unaware of any `uv` workspace**. It can be built, locked, and unit-tested in isolation without `UV_NO_PROJECT=1`.
- `frontend/` stays paired with `backend/` because they are versioned and released together.
- A dedicated **workspace metapackage** (at the repo root or a workspace directory) declares all packages as editable workspace members solely for cross-package development and workspace-wide unit tests.

### Rollout strategy

- Prototype and validate the new layout in a disposable branch first (verifying editable workspace tests, isolated package builds, and `just dev`).
- Because moving package paths invalidates open pull requests, coordinate a short freeze/drain window with the team and land the layout move in a single coordinated PR.

## Phase 2: Local wheelhouse and pre-release testing

Depends on Phase 1; provides the wheelhouse tooling consumed by Phase 3 (`just dev` / cluster submits) and Phase 4 (`cd-major` and pre-tag Docker v3 verification).

- Build candidate wheels (and lock) into a local wheelhouse directory from any branch in CI or locally.
- Prefer a local wheelhouse over `pip install git+...` because it exercises actual built wheels, entry points, and package data, and works identically for CI tests, Docker v3 builds, and local testing.
- Rehearse the thin publish-only steps using PEP 440 pre-releases (PyPI or TestPyPI), GitHub pre-releases (excluded from `/releases/latest`), and scratch Docker tags.
- **Keeps air-gapped / restricted-network installs open:** a local wheelhouse (`uv pip install --find-links`), combined with Cascade's `custom_pip_indices` for task execution environments, provides the building block for restricted HPC or air-gapped hosts if required later.

## Phase 3: `just dev` and cluster submits via local wheelhouse

Depends on Phase 2; independent of Phases 4 and 5.

- Evaluate replacing editable installs in `just dev` with populating a local wheelhouse and running from installed wheels (while keeping editable workspace installs for unit tests via the Phase 1 metapackage).
- **Benefit:** The same wheelhouse tooling serves pre-release testing, `just dev`, and cluster submits (avoiding editable-install divergence on remote workers). Because the backend does not rely on hot reloads or `importlib` reloads, the small startup rebuild cost is acceptable if wheel builds are fast and cached.

## Phase 4: CD workflow redesign and `fiab-core` locking

Depends on Phases 1 and 2; independent of Phase 3.

### Prerequisite decision: `fiab-core` locking policy

Before finalizing the CD workflow interplay, the team must decide how `fiab-core` is locked in backend releases:

- **Option A -- Pin exact `fiab-core` in the backend release lock:**
  - Every `forecast-in-a-box` release is 100% reproducible down to the exact `fiab-core` version it was tested against.
  - Plugins declaring a minimum `fiab-core` newer than the pinned version are rejected cleanly rather than breaking at runtime.
  - **Trade-off:** A non-breaking `cd-minor-core` release cannot be consumed by already-released backend versions until a new `cd-minor-backend` release is also cut to refresh the lock.
- **Option B -- Keep `fiab-core` as a major-version range (`>=X,<X+1`) outside the lock:**
  - Allows `cd-minor-core` + `cd-minor-plugin` to be adopted by existing backend releases without re-releasing the backend.
  - **Trade-off:** Installations of the same backend version are no longer fully deterministic, and an untested `fiab-core` minor version can reach older backends.

**Lockfile and constraints mechanics (to verify before implementation):**
1. **Local wheelhouse vs. PyPI lock:** When a release publishes both a new `fiab-core` and a new `forecast-in-a-box`, a PEP 751 `pylock.toml` exported against a local wheelhouse before publishing will reference local paths rather than PyPI URLs. The pipeline must account for how the published lock references PyPI without re-introducing untested release-only drift.
2. **Constraints for plugins:** `uv pip install` currently treats `pylock.toml` as a standalone install input rather than a `-c constraints.txt` file combinable with extra plugin requirements (as noted in `cd-backend.yml`). If plugins continue sharing the backend venv (or generations per [plugins-candidate_venvs.md](plugins-candidate_venvs.md)), CD will need to export a constraints file alongside `pylock.toml` or use a verified `uv` resolution command. If plugins instead run in isolated per-plugin processes with their own venvs, backend-vs-plugin dependency conflicts largely disappear and the backend can pin `fiab-core` strictly while plugins resolve compatible `fiab-core` minors across a major-versioned IPC boundary.

### Redesigned CD workflows

Replace `cd-core`, `cd-plugins`, and `cd-backend` with:

- **`cd-major`** (breaking / coordinated release):
  - In a single atomic commit, bumps the `fiab-core` major version and updates dependent version constraints across all packages in the repo.
  - Builds all wheels into a local wheelhouse, runs the verification suite (including Docker v3 build and smoke test), and only then publishes all wheels to PyPI, creates the GitHub release, and pushes the Docker v3 image.
  - Eliminates the broken-repo window between `cd-core` and `cd-backend`.
- **`cd-minor-{core,plugins,backend}`** (non-breaking single-component release):
  - Releases a single component group (minor or patch bump) without assuming breaking changes: `core` (`fiab-core` and `fiab-plugin-test`), `plugins` (`fiab-plugin-ecmwf`, `fiab-plugin-demo`), `backend` (`forecast-in-a-box` with frontend; release group for `fiab-mcp-server` to be confirmed).
  - Tests the candidate wheel cleanly against the published PyPI versions of the other components (matching what users install). If it fails despite CI passing, that signals either a breaking cross-package change (requiring `cd-major`) or an unreleased non-breaking dependency change (for example, `cd-minor-core` must be released before `cd-minor-backend`).
  - Backend releases (whether via `cd-major` or `cd-minor-backend`) create the GitHub release and publish the Docker v3 image.

### Pre-tag Docker v3 gating

- Build and smoke-test the Docker v3 image (from [deployment-runtimeAndDockerV3-design.md](deployment-runtimeAndDockerV3-design.md)) against the candidate wheelhouse **before** tagging the release and uploading to PyPI.
- A Docker build or `warmup` failure aborts the release cleanly before anything immutable is published.

### Simplifications to evaluate

- **Tag scheme:** Evaluate whether the `{v,c,p}<version>` tag prefixes are still needed to coordinate components once `cd-major` is atomic and each package is standalone.
- **CI/CD scripting:** Replace brittle bash logic in `scripts/cicd/` with simpler, testable tooling (for example Python scripts) where practical.

## Phase 5: `scripts/fiab.sh` replacement and standalone distribution

Depends on Phases 2 and 4; independent of Phase 3.

### Product requirements

Any standalone installation and upgrade path must preserve three product requirements:

1. **Single stable entry points:** one stable documented URL for installation, and one stable command (`fiab`) for execution and upgrades.
2. **Zero host assumptions:** works on any machine without requiring pre-installed Python or `uv`.
3. **Backwards and forwards compatible** across releases, with no self-modifying user-downloaded files.

### Candidate pattern: throwaway per-version `install.sh` + `fiab` command

With runtime bootstrap moved into the Python `fiab` entrypoint ([deployment-runtimeAndDockerV3-design.md](deployment-runtimeAndDockerV3-design.md)), standalone installation and upgrades can be separated cleanly without a self-updating launcher:

- **Fresh install:** `curl -fsSL <stable_latest_url>/install.sh | bash` (or downloaded and executed via `bash install.sh`).
- **Pinned / pre-release install:** `curl -fsSL <stable_version_url>/install.sh | bash`.
- **Forge-agnostic hosting:** Because the installer is just a plain static HTTP download (no GitHub API calls), it can be hosted on GitHub/GitLab Releases, Generic Package Registry, a project-owned redirect/static URL (such as an ECMWF domain), object storage, or a local wheelhouse. Making the installer base URL configurable in `fiab upgrade` avoids hardcoding GitHub.
- **Embedded version (and optionally lock):** The source script in git carries a sentinel value (for example `FIAB_VERSION="dev"`, interpreted locally as installing from a local wheelhouse or checkout). At release time, CD stamps the exact release or pre-release version into the published `install.sh` artifact. If `pylock.toml` is either embedded in `install.sh` (or fetched relative to the same base URL / local wheelhouse), `install.sh` becomes a single self-contained artifact with zero forge-specific API or path assumptions.
- **Upgrades:** `fiab upgrade [version]` (implemented in Python) resolves the target version (for example from PyPI JSON metadata or a configured mirror) and executes that version's `install.sh`. Each version's `install.sh` only needs to know how to install itself (its own pinned Python, `uv` requirement, and lock).
- **Safe swap:** `install.sh` installs into a versioned venv under the code install directory outside `FIAB_HOME` (default `~/.local/share/fiab/app/vX.Y.Z/`, overridable via env var) and atomically flips a `current -> vX.Y.Z` symlink there, with `~/.local/bin/fiab` pointing to `~/.local/share/fiab/app/current/bin/fiab`. Initially `current` can be a single directory (or a symlink with old versions pruned after swap); keeping versioned directories naturally enables a `previous <-> current <-> next` rollout/rollback flow (or side-by-side versions) later without changing the executable path. 
- **Piping and re-run:** `install.sh` should never read interactive prompts from stdin, is idempotent on re-run, and prints a `PATH` hint if `~/.local/bin` is not yet on `PATH`.
- **Runtime and restart:** `fiab` handles `run`, `service`, `warmup`, and post-upgrade restart coordination. `install.sh` never touches `FIAB_HOME`; state migration or compatibility checks remain TBD in a separate state-evolution spec.

### Minimal cross-version contract

Under this pattern, the entire permanent cross-version surface for standalone installs reduces to:

1. **Stable URLs:** a stable latest-release `install.sh` URL and a per-version `install.sh` URL template (configurable for mirrors/GitLab, or backed by a project-owned domain). If the single-bootstrap-from-PyPI option in Open Question 6(b) is chosen instead, this simplifies further to a single stable `install.sh` URL plus PyPI (or a configured PyPI mirror).
2. **CLI interface:** the `fiab` command on `PATH` (`run`, `service`, `warmup`, `upgrade [version]`).
3. **Code location layout:** a stable default code install directory (matching [deployment-runtimeAndDockerV3-design.md](deployment-runtimeAndDockerV3-design.md), for example `~/.local/share/fiab/app`, overridable via env var) with a `current` entry (`current -> vX.Y.Z` symlink, or initially a single directory) so a newer `install.sh` can atomically replace an older installation and future side-by-side versions remain possible.
4. **State boundary:** `FIAB_HOME` ([deployment-runtimeAndDockerV3-design.md](deployment-runtimeAndDockerV3-design.md)) is never modified by `install.sh`.

### Optional transition from `scripts/fiab.sh`

Whether to support a seamless in-place migration from existing `scripts/fiab.sh` installations or make a clean cutover (with manual migration instructions) can be decided when Phase 5 is scheduled. If an automated in-place transition is desired, timed after [deployment-runtimeAndDockerV3-design.md](deployment-runtimeAndDockerV3-design.md), Phase 2, and Phase 4 are proven:

- **Minor-release sequencing constraint:** The transition release must ship as a minor release so existing `scripts/fiab.sh` installations can reach it via `fiab.sh upgrade` (which only upgrades within the same major version, whereas `reinstall` deletes state).
- **Stub launcher:** In the transition release, `scripts/fiab.sh` becomes a stub. On an existing installation it migrates once: installs the same release through `install.sh`, removes the old venv, `uv`, lock, timestamp, and marker from `~/.fiab` while leaving user state (`user.db`, `job.db`, `config.toml`, `data_dir`) in place, and prints the new `fiab` command. If invoked on a machine with no existing `~/.fiab` (for example from an old bookmark to `main`), it delegates to the latest `install.sh` or prints the new install command.
- **Frozen paths during the transition window:** Releases published during the transition window keep `scripts/fiab.sh` (the stub), `install/pylock.toml`, and `install/config.toml` at their legacy paths so older installed launchers can upgrade to them. The first transition release also tolerates being started once by the old launcher via `python -m forecastbox.entrypoint.main` with legacy env vars.

## Open questions

1. **Top-level package directory layout:** Should standalone packages live directly at the repo root (`backend/`, `fiab-core/`, ...) or under a `python/` subdirectory (`python/backend/`, `python/fiab-core/`, ...) alongside `frontend/` and `cli/`?
2. **`fiab-core` locking policy:** Option A (exact pin in `pylock.toml`, coupling `fiab-core` minor updates to backend releases) or Option B (major-range resolution)?
3. **Wheelhouse-to-PyPI `pylock.toml` generation:** What is the cleanest way to test a local wheelhouse containing an unpublished `fiab-core` while publishing a `pylock.toml` that resolves cleanly from PyPI?
4. **Constraints file for plugins:** Should CD publish an exported constraints file alongside `pylock.toml` for plugin installs and [plugins-candidate_venvs.md](plugins-candidate_venvs.md), or will per-plugin isolated venvs/processes make backend-vs-plugin constraints unnecessary?
5. **Component tags (`{v,c,p}<version>`):** Can component tags be simplified or removed under `cd-major` / `cd-minor-{component}`?
6. **Hosting of `install.sh` and `pylock.toml`:** How to avoid mirroring per-version release assets across forges (for example GitHub and a DestinE GitLab mirror)? Options to evaluate: (a) keep one canonical host (GitHub Releases or an ECMWF/project-owned static URL/redirect) for workstation `install.sh`, while DestinE uses Docker v3 / local wheelhouses; (b) bundle `pylock.toml` (and pinned Python version) inside the `forecast-in-a-box` wheel so PyPI (or any PyPI mirror / wheelhouse) is the single source of truth and only one tiny, version-agnostic bootstrap `install.sh` needs to be hosted (`uv pip install --no-deps --target <tmpdir> forecast-in-a-box==<ver>` populates `uv`'s global cache and extracts the lock/metadata in one step, so the subsequent venv install reuses the cached wheel without redownloading); or (c) embed `pylock.toml` inside per-version `install.sh` assets on a neutral host.
7. **`just dev` wheelhouse startup cost:** Is the local wheelhouse build time fast enough for everyday `just dev` iteration, or should editable `just dev` remain an option alongside a wheelhouse mode?

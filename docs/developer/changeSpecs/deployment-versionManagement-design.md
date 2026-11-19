# Deployment and version management: design

## Status

Proposal (step 1 of the [changeSpecs workflow](README.md)), open for feedback.

- Supersedes the installer/launcher split originally proposed in issue [#169](https://github.com/ecmwf/forecast-in-a-box/issues/169). The explicit `upgrade`/`reinstall` commands delivered in [#757](https://github.com/ecmwf/forecast-in-a-box/pull/757) remain valid until the transition described below.
- Affects the in-app upgrade UI of [#187](https://github.com/ecmwf/forecast-in-a-box/issues/187) (see [Upgrade, rollback, downgrade](#upgrade-rollback-downgrade)).
- Depends on [backend-db_migrations.md](backend-db_migrations.md), which is itself still a proposal. This document only states the requirements it puts on migrations.
- Builds on the release model recorded in [ci-fiab_core.md](ci-fiab_core.md): fiab-core, the plugins and the application are released separately and linked by matching major versions. This design adds a rule for what a release must include ([Release verification](#release-verification)).
- Needs reconciling with [plugins-candidate_venvs.md](plugins-candidate_venvs.md), which currently lists "relevant Forecastbox upgrade" among the changes an environment generation converges to. This design takes changing the Forecastbox version out of the application's scope (see [Interaction with plugin environments](#interaction-with-plugin-environments)).
- The plugin environment model is designed separately. This document only states what it requires from it (see [Interaction with plugin environments](#interaction-with-plugin-environments)).
- The version and state lifecycle, including side-by-side versions and who owns them, is deliberately left as an [open decision](#version-and-state-lifecycle-open-decision) with options.
- What this change must solve, what it fixes along the way, what it keeps open, and what blocks it are summarised in [Priorities](#priorities).

## Context

### Terms

- **Deployer:** whoever installs and operates a Forecast-in-a-Box instance: an end user on a workstation, a site administrator, a system integrator, or the operator of a hub or container platform.
- **Instance:** one running Forecast-in-a-Box application with its state.

### Current state

Forecast-in-a-Box is installed and run in four ways today:

- **`scripts/fiab.sh`** -- the self-bootstrapping launcher for end users, fetched by the user from `main` (the top-level README links to `docs/userGuide.md`, which contains the command). Under `FIAB_ROOT` (default `~/.fiab`) it keeps uv, the release marker, `pylock.toml` and its timestamp, the venv, the config, the databases and `data_dir`. The `run`/`service` commands make sure the environment exists and start the app; `warmup` additionally installs default plugins; `upgrade` and `reinstall` change the release and replace the script itself with the one of the target release.
- **`just dev`** -- runs the working copy from `backend/.venv` (`uv sync --extra runtime --all-packages`) with `FIAB_ROOT=backend/.fiab`. It writes a fake `pylock.toml.timestamp` (`d0.0.1`), copies an example dev config, and duplicates the firstrun logic of `fiab.sh`.
- **`deployment/v2`** -- `Dockerfile-release` downloads `fiab.sh` from `main`, runs `fiab.sh warmup <tag>` at build time, and uses `fiab.sh` as the container entrypoint. `Dockerfile-dev` uses `uv sync` on the source tree, the fake timestamp, and `just dev` as the entrypoint. Images are built and published per release by `.github/workflows/cd-docker.yml`.
- **`deployment/ewc`** -- an older setup that builds the wheel itself into `/app/.venv` and reimplements the runtime bootstrap (lock copy, timestamp, default config) in its own `docker-entrypoint.sh`.

Storage locations are only partly configurable: the two sqlite databases (`sqlite_userdb_path`, `sqlite_jobdb_path`), a single `data_path` (`file://` or `ssh://`) holding both model artifacts and job outputs, the cascade log directory (`cascade_logging_base`), `shared_path` for Slurm, and the worker venv location through the `CASCADE_VENV_ROOT` env var.

Releases are made separately for fiab-core with the test plugin (`c` tags), the ecmwf and demo plugins (`p` tags) and the application (`v` tags). The application's release lock is exported without the workspace packages, so it does not pin fiab-core: a release is tested against one fiab-core version, while an installation resolves the declared range (`>=X,<X+1`) at install time and may get a newer, untested one.

### Observed problems

1. **The user-downloaded file modifies itself.** `upgrade`, `reinstall` and `warmup <version>` overwrite `fiab.sh` in place (`replaceLauncher`). Users do not expect a file they downloaded to change when executed, and it is the hardest part of the script to reason about.
2. **The launcher comes from `main`, the application from a release.** Both the docs and `Dockerfile-release` fetch `fiab.sh` from `main`, so a fresh install runs a launcher that may be ahead of the release it installs.
3. **Code and state share one directory.** In the `deployment/v2` release image, the venv lives in `~/.fiab` together with the databases and config. Mounting a volume there to persist state shadows the installed venv. `deployment/ewc` avoids this only by building a separate `/app/.venv` by hand.
4. **Data of different kinds cannot be placed separately.** Small mutable state, large model artifacts and job outputs, rebuildable caches and temporary scratch space have different storage needs, but model artifacts and job outputs share one `data_path`, and there is lack of separately configured storage classes.
5. **Runtime bootstrap is implemented four times.** Root and `data_dir` creation, config seeding, the firstrun marker, and the lock timestamp are handled in `fiab.sh`, the root `justfile`, `deployment/v2/Dockerfile-dev` and `deployment/ewc/docker-entrypoint.sh`, each slightly differently. Earthkit cache defaults are set only by `fiab.sh`.
6. **The launcher and the backend are coupled implicitly.** The backend reads the `FIAB_RELEASE_MARKER` and `FIAB_FIRSTRUN` env vars exported by `fiab.sh`, parses the `pylock.toml.timestamp` format written by it, and the deprecated `POST /admin/release` route writes the marker and lock itself. The full list is in [Appendix C](#appendix-c-inventory-of-current-couplings).
7. **Repository paths are frozen by installed launchers.** Every installed `fiab.sh` fetches `scripts/fiab.sh`, `install/pylock.toml` and `install/config.toml` from `refs/tags/<tag>/`. Moving any of them in a future release breaks `upgrade` for existing installations.
8. **Installation choices are not the deployer's.** A deployer who wants to install and manage versions differently (HPC modules, Spack/conda, Ansible, a hub spawner, a custom image) has to reverse-engineer what `fiab.sh` does at run time and replicate it, as `deployment/ewc` did.
9. **Releases cannot be tested before they are made.** `fiab.sh` installs only released tags, the lock and default config are fetched from tags, and release-only CI steps (for example the multi-architecture image manifest) run for the first time during a real release. CI tests the repository's packages together, while a release combines the released package with whatever versions of the others are on PyPI, so an application release that relies on an unreleased fiab-core change passes CI and breaks once published ([ci-fiab_core.md](ci-fiab_core.md)).
10. **Installations are not fully reproducible.** The release lock does not pin fiab-core (see Current state), so two installations of the same release can differ.

## Goals

- **G1** The released wheel runs correctly in any environment where it is installed against its lock, which pins every dependency, including the separately released fiab-core. No launcher is needed at run time.
- **G2** Deployers choose how to install Forecast-in-a-Box and how to manage its versions.
- **G3** No file the user downloaded is modified by running it.
- **G4** Code, state, bulk data, caches and scratch space can be placed in separately configured locations.
- **G5** Development, standalone and container deployments share the same runtime behaviour.
- **G6** The cross-version compatibility surface is explicit, minimal and documented.
- **G7** Multi-user deployment behind a hub or proxy (JupyterHub or similar) is not precluded.
- **G8** A laptop user still installs and runs Forecast-in-a-Box with a single documented command each, and the documented install command stays stable across releases.
- **G9** Installing on an air-gapped host is not precluded. There is no current requirement for it, so no procedure is documented until there is one.
- **G10** A release candidate can be built, installed and tested in development and CI from any branch, through the same paths users use. Release-only code and CI steps are kept to a minimum so that nearly everything is covered by tests before a release.

## Priorities

The problems and goals above are not listed in order of importance. This change is driven by:

1. **Testable, reproducible releases** (problems 9 and 10; G10, G1). This is the main driver.
2. **One way of starting the application for every deployment method** (problems 3, 5 and 6; G1, G5). The standalone script, development, and the two container setups currently start the application differently, which is why what CI tests is not what users run. Aligning them is what makes release candidates testable, makes the application usable by deployers who install it differently (G2), and keeps future targets open (G7, G9, side-by-side versions).
3. **Replacing `fiab.sh` for users** with an installer that does not modify itself and installs what it was released with (problems 1 and 2; G3, G8).

Fixed along the way where cheap: separate storage locations (problem 4, G4 beyond separating code from state), config layering, notify-only admin release endpoints, installer conveniences. Kept open: the version and state lifecycle beyond today's single version with in-place upgrade (S1), database migrations (a separate spec), multi-user deployment, air-gapped installation, and the serialisation format of user objects. The [implications table](#implications-and-future-work) marks every item as *core*, *while at it* or *keeps options open*.

**Blocking the core** (to be settled first):

1. The console script name. It becomes a permanent part of the compatibility contract, and `fiab` is already taken by the Rust client in `cli/`.
2. A minimal installer interface. The first version only needs released versions and wheelhouses.
3. How fiab-core gets into the release lock. Today the workspace packages are left out of the exported lock. Pinning the version the release was tested against looks feasible but needs confirming.
4. What counts as "changed since the last release" for the release rule.

**Sequencing constraint:** the switch to the installer must ship in a minor release. An installed `fiab.sh` only upgrades within the same major version, and its `reinstall` deletes the state.

## Non-goals

- Choosing a multi-user solution. This design only lists what keeps that option open.
- Committing to a version and state lifecycle, including side-by-side versions and their owner. The options are laid out in the [open decision](#version-and-state-lifecycle-open-decision).
- Designing storage backends other than the filesystem (for example S3 or another object store), and the details of scratch space management. This design only requires that storage classes are configured separately and addressed in a way that admits other backends; the backends themselves may warrant their own spec.
- Designing the database migration mechanism. This design states the requirements it puts on it.
- Implementation steps. A separate plan document follows once the direction is agreed.

## Evaluation criteria

Each alternative below is scored against the goals:

| Id | Criterion |
|---|---|
| G1 | Wheel runs without a launcher |
| G2 | Deployer chooses install method and version management |
| G3 | No modification of user-downloaded files |
| G4 | Storage classes separable |
| G5 | Same runtime behaviour in dev, standalone and containers |
| G6 | Small, explicit compatibility surface |
| G7 | Multi-user / hub not precluded |
| G8 | Single, stable command to install and to run on a laptop |
| G9 | Air-gapped install not precluded |
| G10 | Release candidates testable in dev/CI, minimal release-only code |

## Alternatives considered

### 1. Status quo: a single self-updating `fiab.sh`

The launcher installs, runs and upgrades, and replaces itself on upgrade.

Rejected: it fails G1, G3, G4, G5 and G10 by construction (problems 1-6, 9 and 10), and its compatibility surface is large but implicit (problem 7). Deployers can only use it or reimplement it (problem 8).

### 2. Installer/launcher split ([#169](https://github.com/ecmwf/forecast-in-a-box/issues/169) as originally proposed)

An `installer.sh` downloads the launcher and lock of a version as a bundle and checks for updates; a `launcher.sh` sets up Python, the venv and the config on every run.

Rejected: it separates installing from running, which [#757](https://github.com/ecmwf/forecast-in-a-box/pull/757) has already achieved at the command level, but keeps the launcher on the run path (G1) and keeps the runtime bootstrap in shell, outside the dev and container paths (G5). It adds a new compatibility surface between installer and launcher versions: which installer works with which launcher, and who updates the installer (G6).

### 3. A Forecast-in-a-Box-owned version manager

`~/.fiab/versions/<version>/` holds each release's environment and launcher, `~/.fiab/current` points at the active one, and a thin, stable shim on the user's PATH execs `current/bin/<command>`. Upgrades build the new version completely, validate it, then switch `current`. Rollback switches back. This is the rustup/pyenv pattern.

Not chosen as the primary direction; it remains one of the options for owning side-by-side versions ([open decision](#version-and-state-lifecycle-open-decision), [Appendix B](#appendix-b-optional-version-manager-layer)):

- The manager becomes the way to install, which works against G2. Docker images, hub spawners and other deployer tooling already have version management of their own (image tags, spawner profiles, modules).
- It freezes more than it appears to (G6): the shim's name and path, the layout it resolves, its calling convention, and above all the hand-off between versions. If version N invokes version N+k to migrate, that interface becomes a cross-version API for the whole supported upgrade window, and version N must still know how to fetch N+k.

### 4. Package-native layered model (chosen)

Forecast-in-a-Box ships a well-behaved Python application: a wheel, its lock and a console script. The application owns its runtime behaviour, including state initialisation and migration. Installing and choosing versions is left to the deployer, with one convenience path for standalone users. See [Chosen direction](#chosen-direction-layered-model).

### Comparison

| | 1. Status quo | 2. Split | 3. Own manager | 4. Layered |
|---|---|---|---|---|
| G1 Runs without launcher | no | no | partial | yes |
| G2 Deployer choice | partial | partial | no | yes |
| G3 No self-modification | no | yes | yes | yes |
| G4 Storage classes separable | no | no | partial | yes |
| G5 Same runtime everywhere | no | no | partial | yes |
| G6 Small explicit surface | no | no | no | yes |
| G7 Hub not precluded | partial | partial | partial | yes |
| G8 Single, stable command | partial | partial | yes | yes |
| G9 Air-gapped install | partial | partial | partial | partial |
| G10 Testable release candidates | no | no | partial | yes |

G9 is partial for all alternatives: each would need a wheelhouse procedure (`uv pip install --find-links`), which this design keeps open. G8 is partial for the status quo because the documented command fetches from `main`.

### Patterns taken from existing tools

| Concern | Precedent | Used for |
|---|---|---|
| Installing an application on a workstation | An isolated application venv with a console script linked onto PATH (the pattern popularised by pipx) | The standalone install path |
| Stable installer URL | rustup and uv: one documented URL that always serves the current installer | The documented install command |
| Server deployment | Image tag = version, state in a volume, rollback = previous tag | Container images |
| State across versions | Django, GitLab, Home Assistant: migrate on startup, back up first, refuse newer state | State migration and downgrade policy |
| In-app upgrade | Grafana, GitLab: report "new version available", do not self-upgrade | The admin release endpoints and [#187](https://github.com/ecmwf/forecast-in-a-box/issues/187) |
| Plugins in immutable deployments | Grafana: bake plugins into a derived image, or install a declared list at startup | Plugins in containers |
| Side-by-side local versions | rustup, pyenv: independently versioned manager, versioned manifest, generated shims | Appendix B |
| User choice among versions | JupyterHub spawner profiles (image tags or command paths) | Side-by-side versions |

## Chosen direction: layered model

### Layers and ownership

| Layer | Owner | Contents |
|---|---|---|
| Artifact | Release pipeline | The `forecast-in-a-box` wheel on PyPI, its `pylock.toml`, default config shipped as package data, a console script; the installer as a GitHub release asset |
| Runtime behaviour | The application | Storage initialisation, config layering, first-run handling, release identity, state migration, refusal to start on newer state |
| Installation and version choice | The deployer | An installer-managed venv (standalone), image tags (containers), spawner profiles (hub), modules / Spack / conda / Ansible (other deployments) |

The rule that makes the layers independent: **the application must run correctly in any environment where the locked wheel is installed, with no launcher involved** (G1). Every launcher, installer and image then becomes optional and replaceable.

### The compatibility contract

This is the complete surface that later releases must keep compatible, and the only one deployers may rely on:

| Item | Lifetime |
|---|---|
| PyPI distribution name `forecast-in-a-box` | Permanent |
| Console script name and its command-line interface (subcommands, options, exit codes) | Permanent, changed only with deprecation across a major version |
| Meaning of `FIAB_ROOT`: the state directory, and the default parent of other storage classes' locations when those are not configured | Permanent |
| Configuration of storage class locations ([Storage classes](#storage-classes)) | Permanent, changed only with deprecation across a major version |
| Configuration sources and their precedence (site, version defaults, user, env vars) | Permanent, changed only with deprecation across a major version |
| State format: forward migration chain from every version in the supported upgrade window | Per release, for the declared window |
| Downgrade policy: a version refuses to start on state written by a newer schema | Permanent |
| The documented installer URL ([Standalone](#standalone-workstation)) | Permanent |
| The mechanism by which the backend requests a restart ([Interaction with plugin environments](#interaction-with-plugin-environments)) | Permanent, changed only with deprecation across a major version |
| Versioned serialisation format of user objects ([future work](#implications-and-future-work)) | Per format version, forward converters only |
| Repository paths fetched by already-installed `fiab.sh` launchers | Until the end of the transition window ([Transition](#transition)) |

For comparison, alternatives 1-3 do not avoid frozen surfaces; they leave them implicit. Alternative 1 already freezes repository paths, the GitHub releases API, the `~/.fiab` layout and file formats, and two env var names. Alternative 3 would add the shim name and path, the versions layout, the shim calling convention and the cross-version hand-off interface.

The items above are the same commitments any Python application makes to its users. None of them is Forecast-in-a-Box-specific machinery.

### Runtime responsibilities moved into the application

The following move from `fiab.sh`, the `justfile` and the container entrypoints into the application, executed by the console script:

- **Storage initialisation.** Create the configured locations of every storage class if missing.
- **Config layering.** Version defaults ship in the wheel as package data; the user config lives in `FIAB_ROOT`; a site-level layer (location to be decided) sits between them; env vars override all. The default config is no longer downloaded from GitHub, which also resolves the `fiab.sh` TODO about separating default and user config.
- **First run.** "First run" becomes "state not yet initialised", detected by the application. It replaces the `firstrun` marker and the `FIAB_FIRSTRUN` env var. Default plugin installation stays tied to it.
- **Release identity.** The running version comes from the installed package metadata (`importlib.metadata`). It replaces the release marker, `FIAB_RELEASE_MARKER` and parsing `pylock.toml.timestamp`.
- **Install receipt.** Installers may write a small receipt into the code location (not the state directory) recording the method, source, version and time of installation. The application reads it only to report its install age and the right upgrade command. Its absence means "installed by an unknown method".
- **Environment defaults.** Defaults currently exported by `fiab.sh`, such as `EARTHKIT_DATA_CACHE_POLICY` and `EARTHKIT_DATA_MAXIMUM_CACHE_SIZE`, are applied by the application unless set. Cache locations follow the cache storage class.
- **State migration.** On startup, if the state schema is older than the application's, migrate it according to the chosen [lifecycle option](#version-and-state-lifecycle-open-decision); if newer, refuse to start.
- **Entry points.** The console script's subcommands replace the `python -m` invocations made by `fiab.sh`: `run` (`entrypoint.main`), `service` (`entrypoint.bootstrap.service`, unified with `run` as its TODO suggests), and `warmup` (`entrypoint.warmup`: initialise state and install default plugins, without starting the server). The `python -m` module paths stay working during the transition window.

### Storage classes

| Class | Contents | Properties | Today |
|---|---|---|---|
| Code | The application environment, plugin environment generations | Rebuildable from locks; replaced, never migrated | venv in `FIAB_ROOT` |
| State | Databases, user config, desired plugin list | Small, mutable, schema-bearing; migrated and backed up; needs reliable storage | `FIAB_ROOT`, sqlite paths configurable |
| Bulk data | Model artifacts (weights, checkpoints); job inputs and outputs | Large; artifacts are immutable and shareable across versions and, read-only, across users; job data grows with use | One `data_path` for both |
| Caches | uv cache, earthkit-data cache, execution environments of tasks (maintained by cascade, location configured by Forecast-in-a-Box) | Rebuildable; may be deleted at any time | Earthkit cache via env vars, uv default |
| Scratch | Worker venvs, temporary cascade logs, temporary files of a run | Short-lived; must be on an exec-mountable filesystem | `CASCADE_VENV_ROOT`, `cascade_logging_base`, system temp |

Requirements:

- Each class has its own configurable location. Model artifacts and job data are configured separately within bulk data, since site administrators may want them on different storage.
- Locations are URLs, as `data_path` already is (`file://`, `ssh://`), so that other backends such as an object store can be added without changing the configuration model. Which classes can live on which backends is decided when a backend is added.
- When a location is not configured, a default is derived: state in `FIAB_ROOT`, other classes in subdirectories of it or in the platform's standard cache and temporary locations. A laptop installation therefore needs no storage configuration at all.
- Only state is ever copied or migrated between versions. Bulk data stays in place and is referenced; artifacts, being immutable, are safe to share between versions. Job data written by a newer version must remain readable by an older one, or be marked with its format version.

### Version and state lifecycle (open decision)

How versions and their state are lifecycled is not decided yet. The options differ in whether users can choose between installed versions, how rollback works, and who owns the set of installed versions. The amount of change needed from today's setup matters as much as the end state.

**Two observations frame the choice:**

- A pre-migration backup is itself a copy of the state. The real difference between "migrate in place with a backup" and "copy and migrate per version" is which copy is live, and who keeps track of the copies.
- Copying state per version is cheap only if state is small. That depends on the [storage classes](#storage-classes) being separated, so that bulk data is shared and never copied.

**Options:**

| | S1: single version, migrate in place | S2: single active version, previous kept | S3: side-by-side versions, state per version | S4: side-by-side versions, shared live state |
|---|---|---|---|---|
| Upgrade | Install new version; on first start, back up state and migrate it in place | Build the new version beside the old one, validate it, switch; back up and migrate state on first start | Build the new version with its own copy of the state, migrated from the current version's | Install beside, both use the same state |
| Rollback | Reinstall the previous version and restore the backup: two manual steps | Switch back to the kept version and restore the backup, done by whoever performed the switch | Select the previous version; its state is as it was before the upgrade | Select the previous version |
| User selection between versions | No | No | Yes | Yes |
| Data written after upgrade, on rollback | Lost, unless exported | Lost, unless exported | Stays with the newer version; can be moved with the serialisation format | Shared |
| Who owns the set of versions | Deployer (one version at a time) | Installer (standalone) or deployer | Needs an owner: deployer, or a Forecast-in-a-Box manager | Same as S3 |
| Lifecycle of the version set | Not applicable | Keep one previous version | Install, remove, default version, number kept, pruning state copies | As S3 |
| Cross-version commitments | Forward migrations, refusal on newer state | As S1 | As S1, plus whatever the switching mechanism requires | Every schema change readable and writable by N and N+1 (expand/contract), forever |
| Change from today | Smallest: same single-root layout, add schema versions, migrations and backup | Moderate: code locations per version, installer switching logic | Largest: new layout, an owner for the version set, state copies | Largest, plus permanent schema discipline |

S4 is listed for completeness and is not considered viable.

**How a user would switch between versions** (S3 only):

- by a command-line option or command (for example selecting the version to run);
- by running versions as separate instances on separate ports or URLs;
- by a version-independent front door (a launcher page, or a hub) that lists installed versions and starts the selected one. This is the most convenient for users and the strongest cross-version commitment, since the front door must work with every version it can start;
- by a hub spawner profile, where the deployer's hub is the front door and Forecast-in-a-Box provides no switching component.

**Possible owners of the version set** (S2 and S3):

- **The deployer**, using its own tooling: image tags with one state volume per version, spawner profiles, modules. Forecast-in-a-Box only provides the building blocks below.
- **A Forecast-in-a-Box manager** for standalone installations ([Appendix B](#appendix-b-optional-version-manager-layer)), which brings its own cross-version commitments.
- **A hybrid**: Forecast-in-a-Box defines the per-version layout and the building blocks, and both deployer tooling and an optional thin manager use them.

**Building blocks needed by every option**, which can be built before the decision:

- persisted schema versions and forward migrations, with refusal to start on newer state;
- an application command that creates a migrated copy of the state from another state location. It covers taking a pre-migration backup (S1, S2), seeding the state of a new version (S3), and restoring;
- the separation of storage classes;
- the versioned serialisation format of user objects, for moving data between versions outside the migration chain.

Variants of side-by-side versions and what they freeze are described in [Appendix A](#appendix-a-user-selectable-side-by-side-versions).

Requirements on the migration mechanism of [backend-db_migrations.md](backend-db_migrations.md), common to all options:

- A persisted schema version per database, updated transactionally with each migration.
- Refusal to start, rather than best effort, when the persisted schema version is newer than the application knows.
- A declared supported upgrade window. Upgrades from outside the window go through the serialisation format (export, then import into fresh state) or are not supported.

That spec currently rejects Alembic as too "server-oriented" for end-station software. The multi-user direction weakens that argument, so the choice should be revisited.

### Deployment paths

#### Standalone (workstation)

A one-shot installer replaces `fiab.sh` as the documented entry point. It is idempotent (running it again repairs an installation) and never modifies itself.

- **Distribution.** PyPI hosts only Python distributions (wheels and sdists), so the installer script is published as a GitHub release asset. The documented command uses GitHub's stable latest-release URL, `https://github.com/ecmwf/forecast-in-a-box/releases/latest/download/install.sh`, which always serves the installer of the newest release and excludes pre-releases. Specific releases, including release candidates, are reachable at `.../releases/download/<tag>/install.sh`. The top-level README keeps linking to the user guide, and the command in the user guide stays the same across releases (G8).
- **Sources, all explicit, no automatic fallback.** The installer can install:
  - a released version from PyPI, the latest one by default;
  - a pre-release, only when asked for explicitly;
  - a git reference of the repository or a fork;
  - a local checkout, optionally editable;
  - wheels from a local directory (a wheelhouse), for testing release candidates built in CI, and potentially for air-gapped hosts.

  A request that cannot be satisfied from the requested source is an error with a hint, for example suggesting a git source when a version exists as a tag but not on PyPI. The exact command-line syntax is decided at implementation time. Accepting the uv/pip requirement syntax (for example `forecast-in-a-box==X.Y.Z`, `forecast-in-a-box @ git+https://...@ref`, `-e <path>`) should be considered, so that sources can be copied from project files and documentation.
- **Lock per source:** a release uses its published lock; a git reference or local checkout uses a lock exported from its own `uv.lock`; a wheelhouse comes with the lock it was built with.
- **Prerequisite check:** all missing or outdated prerequisites are reported at once, with install hints, before anything is changed. Prerequisites depend on the source: curl and uv (new enough to read `pylock.toml`) for a release; additionally git and node/npm (versions pinned in `frontend/package.json`) for git references and local checkouts. `just` is not required for installing; the frontend build is moved into a plain script that both the `justfile` and the installer call.
- **Opt-in installation of prerequisites** into a user-local directory, without sudo or system package managers. The pinned Python interpreter is always installed through uv, since it is part of the locked environment rather than a host prerequisite.
- **A check-only mode** that reports prerequisites, for troubleshooting and support.
- **Mechanism:** an installer-managed venv, created with `uv venv` and populated with `uv pip install` against the lock, with the console script linked onto PATH. `uv tool` is not used: it is intended for external tools a project uses, and its environments are not meant to be modified, whereas the application installs plugins into its own environment.

After installation the user runs the console script. The installer is not on the run path.

#### Containers

- The application is installed in the image against the lock, into a fixed location outside `FIAB_ROOT`.
- State lives in a volume mounted at `FIAB_ROOT`. Bulk data, caches and scratch can be mounted separately according to the [storage classes](#storage-classes).
- The entrypoint is the console script.
- How plugins are handled is open ([open question 7](#open-questions)): baked into the image or a derived image (`FROM <image>:<tag>`) with runtime plugin changes disabled, or plugin environments kept on a mounted volume, which keeps container and non-container installations closer. Both may be offered as a deployment option.
- Version management is the image tag. How versions and state are lifecycled follows the [open decision](#version-and-state-lifecycle-open-decision); with S3, each version gets its own state volume.
- Images are built from wheels, so release candidates built in CI can be turned into images and tested before a release (G10).
- `Dockerfile-dev` uses the same layout over an editable install, without the fake timestamp.

#### Development

`just dev` becomes: build the frontend if stale, sync the editable workspace, run the console script with `FIAB_ROOT=backend/.fiab`. The firstrun logic, fake timestamp and config copying are removed because the application handles them.

#### Other deployments

Other deployers install the wheel against the lock however they like and run the console script with `FIAB_ROOT` (and optionally a site config and storage locations) set. The [compatibility contract](#the-compatibility-contract) is everything they may rely on and is documented as such in `docs/operator/`.

### Release verification

Release candidates go through the same paths as releases, from any branch (G10).

**What a release includes.** A release includes every package of the repository that has changed since its last release, together with the packages that depend on it, so that the combination users get from PyPI is the combination CI tested. Each release workflow checks this before building: if a package it depends on has changed since that package's last release and is not part of the release, it fails and names the package to include. "Changed" refers to a package's source and metadata, not to its tests or documentation. Packages that have not changed are identical on PyPI and in the repository, so CI's check that the repository is mutually consistent then describes what is released. This is the "release components in a single action" option of [ci-fiab_core.md](ci-fiab_core.md), enforced by a check rather than by always releasing everything. It does not cover a later fiab-core release reaching application versions that are already installed; pinning fiab-core in the release lock (G1) covers that.

1. CI builds the wheels of all packages in the release into a wheelhouse and exports the lock, including fiab-core, without publishing anything.
2. The installer installs from that wheelhouse into a clean environment, and the test suite and a smoke start of the console script run against it.
3. A container image is built from the same wheelhouse and smoke-tested.
4. Plugins are tested in the resulting environment, as they run in production.

Nothing is published until every package in the release has been built and tested, since uploads to PyPI cannot be undone. What remains release-only is publishing: uploading to PyPI, tagging, creating the GitHub release with its assets, and pushing images and their multi-architecture manifest. These steps are kept as thin as possible and are rehearsed by publishing pre-releases: a PEP 440 pre-release version on PyPI (or TestPyPI), a GitHub pre-release (not served by the latest-release URL), and scratch image tags. A pre-release is installable through the installer's explicit pre-release source, so it can be tested end to end exactly as users will receive the release.

### Upgrade, rollback, downgrade

The mechanics of upgrade and rollback depend on the [open decision](#version-and-state-lifecycle-open-decision). Independently of it:

- The application never changes its own version. The admin release endpoints become notify-only: they report the running version, its install age and the newest available release, and show the upgrade command for the install method recorded in the receipt. The deprecated `POST /admin/release` is removed. This is a deliberate change from the goal in [#169](https://github.com/ecmwf/forecast-in-a-box/issues/169) that the backend could upgrade itself, and the [#187](https://github.com/ecmwf/forecast-in-a-box/issues/187) UI should be scoped accordingly. A self-upgrade action could be added later for the standalone path only, if the install method and a supervisor able to restart the application are both known.
- The latest release is determined from the PyPI JSON API, the same source the install uses. This removes the dependency on the GitHub releases API and its unauthenticated rate limit.
- Downgrading always means returning to the state of the older version (a backup or a per-version copy); an older version never runs on newer state.

### Interaction with plugin environments

- Today plugins are installed at run time into the application's own venv, constrained by its current state (`utility/packages.py`).
- This is expected to be replaced by generations, designed separately: a plugin change builds a new environment for the backend (the release lock plus the plugins' dependencies), validates it, and activates it by restarting the backend. Nothing is installed into the running environment.
- Activating a generation requires restarting the backend, so every deployment path provides something that restarts it. A deployment that provides no restart mechanism disables runtime plugin changes.
- The desired plugin list is state. Generations belong to the code storage class: they are derived from the desired plugin list and the release, so they can be rebuilt, and a generation is rebuilt when the application version changes. Where generations are stored, and how the console script starts the backend in the active one, is [open question 8](#open-questions).
- The Forecastbox version inside a generation is fixed by the deployer's installation. Changing it is never a generation change the application performs on its own.
- Execution environments of tasks are separate from generations. They are created from task requirements by cascade, which belongs to earthkit-workflows; Forecast-in-a-Box supplies constraints and configures where they are cached (cache and scratch storage classes).
- In containers, plugin handling is [open question 7](#open-questions).

## Implications and future work

Each item names the goals it serves and its priority ([Priorities](#priorities)): *core* items are what this change must deliver, *while at it* items are fixed along the way if cheap, and *keeps options open* items are needed only for future directions and can be scheduled independently.

| Item | Goals | Kind |
|---|---|---|
| Console script entry point with `run`, `service`, `warmup` subcommands | G1, G5 | core |
| Runtime responsibilities moved into the application (initialisation, first run, release identity, env defaults) | G1, G5 | core |
| Code moved out of `FIAB_ROOT`, so state can be persisted separately from the installed application | G4, G5 | core |
| Default config shipped as package data, no longer fetched from release tags | G1, G10 | core |
| Installer for released versions and wheelhouses, with prerequisite check | G3, G8, G10 | core |
| Installer published as a release asset at a stable latest-release URL | G8 | core |
| Release pipeline publishes the installer and the lock (and an exported constraints file, if needed) as release assets | G3, G8 | core |
| CI builds and tests release candidates from wheelhouses, including images; publishing steps rehearsed with pre-releases | G10 | core |
| Release rule: release workflows check that every changed package a release depends on is part of it | G10 | core |
| Release lock pins fiab-core at the version the release was tested with; plugins' with declared minimum fiab-core version higher than that are rejected outright rather than fail at runtime. | G1 | core |
| Container images rebuilt on the new layout, plugin handling per open question 7 | G4, G5 | core |
| Transition: `fiab.sh` stub, frozen paths kept, shipped in a minor release | G3, G8 | core |
| Operator documentation of the compatibility contract | G2, G6 | core |
| Storage classes with separately configurable locations, including model artifacts and job data separately | G4 | while at it |
| Site / version / user config layering | G2 | while at it |
| Persisted schema versions and refusal to start on newer state | G6 | while at it |
| Installer conveniences: git and local-checkout sources, opt-in prerequisite installation, check-only mode | G8 | while at it |
| Frontend build moved from the `justfile` into a plain script | G5, G8 | while at it |
| Admin release endpoints made notify-only, install receipt | G2, G6 | while at it |
| Forward state migrations (designed in [backend-db_migrations.md](backend-db_migrations.md)) | G6 | keeps options open |
| Application command creating a migrated copy of state from another location | G6 | keeps options open |
| Decision on the version and state lifecycle beyond S1 | G2, G6, G7 | keeps options open |
| Desired plugin list kept as state, restart mechanism for activating plugin generations; needed when plugin generations are introduced | G1, G5 | keeps options open |
| Air-gapped installation (wheelhouse + `--find-links`), covering the packages of execution environments as well as the application (cascade's `custom_pip_indices` already lets workers use extra package sources); documented once there is a requirement | G9 | keeps options open |
| Storage backends other than the filesystem (for example an object store); possibly a separate spec | G4, G7 | keeps options open |
| Versioned serialisation format for user objects (blueprints, experiments, glyphs, ...) with forward converters | G6, G7 | keeps options open |
| Prefix-safe serving: the frontend has only a build-time `VITE_API_BASE_URL`, no router base path, and the backend sets no `root_path`; serving under `/user/<name>/` needs a runtime-configured base path | G7 | keeps options open |
| Auth delegation to a hub: `auth.passthrough` behind a trusted proxy, or acting as a hub OAuth client (the existing OIDC support may not fit directly, since JupyterHub does not necessarily provide OIDC discovery) | G7 | keeps options open |
| Activity reporting for idle culling | G7 | keeps options open |
| Separate state per version and per instance, enforced (two versions on one state location is refused) | G7 | keeps options open |
| Shared read-only model artifact store across users and versions | G4, G7 | keeps options open |

The serialisation format serves three purposes at once: upgrades outside the supported migration window, moving work between side-by-side versions, and sharing work between users and sites. The `upgradeMajor` TODO in `fiab.sh` already anticipates such a dump.

## Transition

- **Stub launcher.** The last release that ships a functional `scripts/fiab.sh` is followed by one whose `scripts/fiab.sh` is a stub. An existing installation reaches it through the old `fiab.sh upgrade`. On its next run the stub migrates the installation once: it installs the same release through the new path, removes the venv, uv, lock, timestamp and marker from `~/.fiab`, and leaves the state (databases, config, `data_dir`) in place, since `~/.fiab` remains the default `FIAB_ROOT`. It then tells the user which command to use from now on.
- **Reachable by `upgrade`.** The stub release must be reachable by the old `fiab.sh upgrade`, which only upgrades within the same major version. The old `reinstall` deletes `FIAB_ROOT`, so a transition that forces users to reinstall would lose their state.
- **Old-launcher compatibility for one upgrade.** The old launcher, when upgrading, installs the new wheel into the old venv and starts it with `python -m forecastbox.entrypoint.main` and the old env vars. The first release on the new model must survive that once, so it keeps the `python -m` entry points and tolerates the old env vars and files.
- **Frozen paths.** Existing tags are immutable, so files at old tags stay available. Every release published during the transition window keeps `scripts/fiab.sh` (the stub) and `install/pylock.toml` and `install/config.toml` at their current paths, since old launchers fetch them for the release they upgrade to. The window ends when installations on pre-transition releases are no longer supported.
- **Documentation.** The user guide switches to the stable installer URL. For the duration of the transition window it also lists the old `fiab.sh` method, marked as deprecated, with the note that existing installations move over through `fiab.sh upgrade`. The `fiab.sh` URL on `main` keeps serving the stub, so old instructions copied elsewhere still lead to the new path. The top-level README keeps linking to the user guide and does not change.
- **Containers.** Images on the new layout move the venv out of `/home/fiab/.fiab`. Users of `deployment/v2` images who mounted that directory keep their state and must no longer rely on the venv being there.
- **Other files and CI.** `docs/operator/installation.md`, `deployment/v2`, `cd-docker.yml` and `deployment/ewc` (or its retirement) are updated together with the first release on the new model.

## Open questions

1. Can the release `pylock.toml` be used directly as constraints for plugin installs and by other deployers, or does CD need to export a separate constraints file as a release asset?
2. What is the supported upgrade window: any older version within the same major, plus the last minor of the previous major?
3. What is the console script called? `fiab` is already the binary name of the Rust client in `cli/`.
4. Where does the site-level config live, and how is it located (fixed path, env var)?
5. What are the default locations of the storage classes other than state on each platform, and which configuration keys and env vars name them?
6. Should `deployment/ewc` be migrated to the new layout or retired in favour of `deployment/v2`?
7. How are plugins handled in containers: baked into the image (or a derived image) with runtime changes disabled, plugin environments on a mounted volume, or both as a deployment option? With environments on a volume, a generation contains the application itself and must be rebuilt when the image's application version changes. To be settled together with the plugin environment model.
8. Where do plugin generations live within the code storage class, and how does the console script, installed in the base environment, start the backend in the active generation?
9. Which installer command-line syntax: its own options, the uv/pip requirement syntax, or both?

## Appendix A: user-selectable side-by-side versions

This appendix describes what letting users choose between installed versions would involve, as input to the [open decision](#version-and-state-lifecycle-open-decision).

**Variant 1: one instance per version.** Each installed version runs as its own instance with its own state (option S3). Users pick a version when starting it: from the command line, from a front door listing installed versions, or from a hub spawner profile. Within one instance nothing changes. What it requires:

- a lifecycle for the set of installed versions: adding a version (with a migrated copy of the state of an existing one), removing a version and its state, choosing a default, limiting how many are kept;
- an owner for that lifecycle (the deployer, a Forecast-in-a-Box manager, or a hybrid);
- if a front door is provided by Forecast-in-a-Box, a stable interface between it and every version it can start: how versions are discovered, started, stopped and addressed.

**Variant 2: per-job version selection within one instance.** One user interface and backend, with several execution environments of different versions; users choose the version for a job. The boundary between versions lies between the backend and the execution side: the cascade gateway, its workers, and the plugins built on fiab-core. It would allow, for example, reproducing an old forecast exactly. What it would freeze:

- the backend-to-gateway and gateway-to-worker protocols, supported across a declared range of versions;
- the fiab-core plugin API across the same range;
- blueprints declaring which version they target, and the rules for compiling them against an older one.

Variant 2 is deferred until a concrete reproducibility requirement appears. One development would force the decision earlier: if multi-user deployments run cascade as a single shared service, several Forecast-in-a-Box versions talk to one gateway and its protocol becomes a cross-version API whether planned or not. Gateways should then either be pinned per version, or the protocol treated as a versioned contract from the start.

## Appendix B: optional version manager layer

If keeping several versions installed side by side on one workstation becomes a requirement and no deployer tooling owns them, a version manager can be added on top of the layered model without changing it. To keep its compatibility surface small, it follows rustup rather than a self-updating script:

- The manager is versioned and updated independently of the application, through its own rarely-changing channel.
- Releases are described by a manifest with a `manifest_version` and a `min_manager_version`. The manager installs any release whose manifest it understands and asks to be updated otherwise.
- The manager never migrates state itself; it calls the application's command for creating a migrated copy of state, so it has no migration hand-off of its own to keep compatible.
- Shims are generated by the manager, not copied by users, so they can be regenerated after a manager update.

Hub deployments get side-by-side versions from spawner profiles instead and do not need this layer.

## Appendix C: inventory of current couplings

To be removed or kept deliberately during the transition:

- `fiab.sh` exports `FIAB_RELEASE_MARKER` and `FIAB_FIRSTRUN`, read by `backend/src/forecastbox/domain/admin/__init__.py`.
- `pylock.toml.timestamp` (`<epoch>:<version>`) is written by `fiab.sh` without a `v` prefix and by `save_pylock` with one, read by `get_local_release`, and faked as `d0.0.1` by the root `justfile` and `deployment/v2/Dockerfile-dev`. `deployment/ewc/docker-entrypoint.sh` writes it too.
- The lock is fetched by `fiab.sh` from `refs/tags/<tag>/install/pylock.toml`, but by `get_pylock` from the `releases/download/<tag>/pylock.toml` release asset.
- The latest release is determined by `fiab.sh` from `/releases/latest` (which excludes pre-releases) and by `get_most_recent_release` from `/releases?per_page=1` (which does not).
- The deprecated `POST /admin/release` writes the marker and lock without replacing the launcher or checking the upgrade scope.
- The firstrun logic is duplicated in `fiab.sh` and the root `justfile`.
- The runtime bootstrap is reimplemented in `deployment/v2/Dockerfile-dev` and `deployment/ewc/docker-entrypoint.sh`.
- Earthkit cache defaults are exported only by `fiab.sh`.
- `fiab.sh` invokes `forecastbox.entrypoint.main`, `forecastbox.entrypoint.warmup` and `forecastbox.entrypoint.bootstrap.service` by module path; comments in those modules refer back to it.
- Installed launchers fetch `scripts/fiab.sh`, `install/pylock.toml` and `install/config.toml` from release tags.
- The default artifact store in `utility/config.py` points at `refs/tags/${TAG}/install/artifacts.json`, freezing that path from the application side as well.
- `fiab.sh` downloads `config.toml` once and never refreshes it.
- `deployment/v2/Dockerfile-release` and the installation docs fetch `fiab.sh` from `main`.

# Plugin environment model: design

## Status

Proposal (step 1 of the [changeSpecs workflow](README.md)), open for feedback.

- Partially supersedes [plugins-candidate_venvs.md](plugins-candidate_venvs.md): environment generations and validation before activation are kept, the near-zero-downtime backend handover is replaced by a restart. Live migration remains a possible later optimisation.
- Addresses the install scenario of [ci-fiab_core.md](ci-fiab_core.md), which asks that users and developers cannot create a broken environment, or failing that, have a means to restore a working one. It keeps that document's decisions: plugins mirror fiab-core's major version and declare a fiab-core range, and saved blueprints are handled as in its migration scenario.
- Deployment (how Forecast-in-a-Box is installed, upgraded and run) is designed separately. This document only states what it requires from it ([Requirements on deployment](#requirements-on-deployment)).
- Splits responsibilities between Forecast-in-a-Box and earthkit-workflows (which ships cascade). earthkit-workflows keeps owning the declaration of task requirements and takes on the realisation of execution environments; Forecast-in-a-Box owns plugin conventions, known-good sets derived from the installation, the control-plane environment, and triggers for preparing environments ahead of runs. earthkit-workflows must not depend on Forecast-in-a-Box. The changes it needs are staged and need agreement with its maintainers ([Requirements on earthkit-workflows](#requirements-on-earthkit-workflows)).
- Governance for plugins developed outside this repository (published targets, conformance tooling, an author guide) is deferred until there is a need for it ([Appendix C](#appendix-c-governance-deferred)).

## Context

### Current state

**Control plane.** The backend imports every plugin in-process (`domain/plugin/loading.py`: import `module_name`, read its `plugin` attribute) and calls the fiab-core `Plugin` interface: `catalogue`, `validator`, `expander`, `compiler`, `blueprint_templates`. Plugins pin `fiab-core>=X,<X+1`. Plugins are installed at run time into the running backend's venv, constrained by a freeze of that same venv (`domain/plugin/compatibility.py`, `utility/packages.py`).

**Declaring task requirements (earthkit-workflows).** A task's requirements are a list of pip requirement strings in `Requirements(environment=[...])`. They are attached through `NodeMetadata`, through the `NodeMetadataContext` stack, or through the `@environment_requirements` decorator. `_resolve_node_metadata` merges all sources by set union, and `graph2job` copies the result into `TaskDefinition.environment`. fiab-core's `QubedPluginBuilder` pushes the plugin's `base_environment` (for example `["fiab-plugin-ecmwf"]`) as a context around every block, and blocks add their own lists. `domain/run/compile.py` post-processes the resulting `JobInstance` before submission (`_hotfix_gpu_availability`).

**Where requirement sets come from:**

| Source | Example | Known when | Owner |
|---|---|---|---|
| Plugin base | `fiab-plugin-ecmwf` | Plugin release | Plugin |
| Plugin capability | `environments.py` lists for mars, opendata, polytope; inline lists for plotting, zarr, geography | Plugin release | Plugin |
| Upstream earthkit-workflows libraries | pproc's `ENVIRONMENT["ppruntime"]` | Library release | earthkit-workflows libraries |
| Model checkpoints | `pip_package_constraints` of a checkpoint in the artifact catalog, used by anemoi inference blocks (`anemoi/utils.py`) | Artifact catalog update | Artifact catalog |

The model checkpoints are the main source of conflicting environments: `install/artifacts.json` currently holds 11 checkpoints with 10 distinct constraint sets, pinning different versions of torch, anemoi-models and torch_geometric, some with direct wheel URLs for a single platform. They change with the artifact catalog, not with plugin releases.

**Execution (cascade).** The cascade gateway spawns a separate process tree per job, and an `Executor` is constructed per job. Each worker starts with a fresh temporary venv that is deleted when the worker or the job ends. The venv gets earthkit-workflows pinned to the backend's version; its dependencies, including cloudpickle, are resolved afresh and may differ from the backend's. `PackagesEnv` installs each task's requirements into the worker's venv on demand, pinning already-imported distributions, and only warns when a requirement conflicts with an imported version. `TaskDefinition.requires_new_worker` makes cascade restart a worker with a fresh venv, but earthkit-workflows' `Requirements` does not expose it and Forecast-in-a-Box never sets it. `JobInstanceRich.custom_pip_indices` lets a job add package indices for worker installs; there is no equivalent for constraints. Task outputs passed between workers are serialised with cloudpickle unless a serde is registered for the type (`cascade/executor/serde.py`). On remote infrastructure (ssh, slurm, troika) the earthkit-workflows wheel is staged per job (`cascade/gateway/spawning/wheels.py`).

**Testing and release.** CI tests all workspace members together in one venv synced from the workspace `uv.lock`, including every extra and dev group. Plugin releases test each wheel alone in a fresh, unlocked venv. Production runs plugins inside the application's locked environment. These three environments differ, and recent releases failed on exactly those differences.

### Observed problems

1. **Plugin installs mutate the running backend's environment.** [plugins-candidate_venvs.md](plugins-candidate_venvs.md) exists to address this, at the cost of a list of process-wide concerns (handover, websockets, scheduler fencing, in-flight requests).
2. **Co-installability depends on installation history.** A plugin is checked against whatever happens to be installed, including leftovers of earlier installs, so the outcome depends on the order in which plugins were installed and updated.
3. **Execution environments depend on task order.** The versions in a worker's venv depend on which task ran on it first. Conflicts surface in the middle of a run, and nothing is recorded that would allow reproducing the environment.
4. **Environments are resolved for every job.** Every worker of every job creates a venv and resolves and installs its requirements again.
5. **Conflicting execution requirements are not handled.** A task whose requirements conflict with what its worker has already imported gets a warning and a possibly broken environment; the restart mechanism cascade has is not reachable from Forecast-in-a-Box.
6. **A plugin's execution dependencies live in code, not in its package metadata.** They are lists inside block code, separate from the plugin's `pyproject.toml`, so they cannot be checked or resolved before a job runs.
7. **Serialisation across environments is unchecked.** Functions are cloudpickled in the backend and unpickled in workers whose cloudpickle version is not pinned to the backend's. Task outputs are cloudpickled library objects whose library versions may differ between producer and consumer.
8. **Development, release testing and production use different environments** (see Testing and release above).

## Goals

- **G1** One control-plane environment per Forecast-in-a-Box instance (backend plus plugin base dependencies), built from the installed application and the desired plugins, not from installation history.
- **G2** Tasks of one job may need different execution environments, including mutually conflicting ones.
- **G3** Resolution happens once per distinct requirement set and constraints, not per run. Sets known in advance can be prepared before the first run that needs them.
- **G4** Execution environments are deterministic, independent of task order, and recorded with each run.
- **G5** A worker is restarted only when a task's environment cannot coexist with the worker's current one.
- **G6** The contract for plugin authors is small, explicit and based on standard packaging metadata. Mechanical checking of it is deferred with governance.
- **G7** Plugins do not need to coordinate their environment definitions with each other.
- **G8** Works with any deployment that meets the [requirements on deployment](#requirements-on-deployment), including installer-managed venvs, container images and possible multi-user deployment.
- **G9** earthkit-workflows does not depend on Forecast-in-a-Box. Execution-environment machinery is generic and lives with the declaration and execution of task requirements.
- **G10** Requirement sets not known at plugin release time are first-class: sets defined by data (model checkpoints) and by upstream libraries are handled by the same mechanism as plugin-defined ones.

## Non-goals

- Live migration of plugin versions without a backend restart. A restart is accepted for now; live migration is a possible later optimisation ([Appendix A](#appendix-a-plugin-hosts-deferred) describes a variant that makes it simpler).
- Governance for plugins developed outside this repository ([Appendix C](#appendix-c-governance-deferred)).
- Designing the earthkit-workflows implementation. This document states requirements and their staging.
- Choosing the format in which resolved environments are stored, or whether workers require uv (see [Open decisions](#open-decisions)).
- Deciding how plugins are handled in container deployments (see [Open questions](#open-questions)).
- Sandboxing untrusted plugins.

## Alternatives considered

### 1. Status quo

One mutable backend venv; per-worker venvs that grow with each task's requirements. Fails G1, G3, G4 and G5, and does not support G2.

### 2. Candidate venv generations with backend handover

[plugins-candidate_venvs.md](plugins-candidate_venvs.md): every plugin change builds a complete candidate environment and a second backend; traffic moves once the candidate is healthy. It solves the mutation of the running environment, but at a high cost in process-wide coordination, and it does not address the execution side (problems 3-7).

### 3. Plugin hosts

Plugin control-plane code runs outside the backend process: either all plugins in one separate host process, or each plugin in its own host with its own environment. Deferred, since a single control-plane environment is not an unreasonable requirement for plugins ([Appendix A](#appendix-a-plugin-hosts-deferred)). It addresses the control plane only.

### 4. One execution environment per job

The union of all task requirements of a job. Deterministic and simple, but fails G2: tasks with conflicting requirements, such as inference with two different checkpoints, cannot share a job.

### 5. One execution environment per task, without grouping

Every distinct requirement set gets its own environment, and workers switch between them. Satisfies G2, but restarts workers whenever the requirement set changes, even between compatible sets (fails G5).

### 6. A Forecast-in-a-Box execution project

Plugin execution dependencies become extras ("profiles"). Forecast-in-a-Box generates a project with one dependency group per extra, locks all of them together with declared conflicts whenever the plugin set changes, and rewrites `TaskDefinition.environment` with fully pinned lists after `graph2job`. An earlier draft of this document proposed it. Rejected:

- It only sees plugin extras. Requirement sets from model checkpoints and upstream libraries, which are the main source of conflicts, would still be resolved by cascade, so there would be two resolvers with different rules (fails G10).
- Resolving at plugin-install time cannot cover sets that appear with new artifacts.
- Forecast-in-a-Box would overwrite a field that earthkit-workflows owns, after earthkit-workflows has computed it.
- The machinery itself (requirement set and constraints to a resolved, cached environment and a worker bound to it) is generic and useful to any earthkit-workflows user.

Its plugin-facing half, extras as the declaration of plugin execution dependencies, is kept in alternative 7.

### 7. Constrained control plane, plugin extras, environments realised by earthkit-workflows (chosen)

The control plane stays a single environment in Forecast-in-a-Box, built from the installed application and the desired plugins under constraints derived from the installation. Plugins declare execution dependencies as extras and reference them in task requirements through standard pip requirement strings, which current cascade already accepts. earthkit-workflows turns any task requirement set, together with job-level constraints supplied by Forecast-in-a-Box, into a deterministic, cached environment, and binds workers to environments. The changes in earthkit-workflows are generic and staged.

### Comparison

| | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| G1 Single control plane, independent of history | no | partial | partial | no | no | yes | yes |
| G2 Conflicting task environments | no | no | no | no | yes | yes | yes (stage 1) |
| G3 Resolution once per set | no | no | no | partial | partial | partial (plugin sets only) | yes (stage 1) |
| G4 Deterministic, recorded | no | no | no | yes | yes | partial (plugin sets only) | yes (stage 1) |
| G5 Restart only across conflicts | n/a | n/a | n/a | n/a | no | yes | yes (stage 2) |
| G6 Small, standard contract | no | no | no | partial | partial | yes | yes |
| G7 No coordination between plugins | no | no | yes | no | partial | yes | yes |
| G8 Deployment-compatible | no | partial | yes | yes | yes | yes | yes |
| G9 Generic machinery in earthkit-workflows | yes | yes | yes | depends | depends | no | yes |
| G10 Data-defined sets first-class | no | no | no | partial | yes | no | yes |

### Precedents

| Concern | Precedent | Used for |
|---|---|---|
| One environment, plugins from many organisations | Airflow constraints files per release; Home Assistant core package constraints; conda-forge global pinning | Known-good sets; their publication is deferred ([Appendix C](#appendix-c-governance-deferred)) |
| Mechanical plugin validation | napari `npe2 validate`; Home Assistant integration checks | The conformance kit, deferred ([Appendix C](#appendix-c-governance-deferred)) |
| Environments keyed by content | pre-commit, tox, Nix | Resolution and environment caching |
| Task-level environments owned by the execution engine | Ray `runtime_env`, Snakemake and Nextflow per-rule environments | Environments realised by earthkit-workflows |
| Plugin change requires restart | Grafana, Jupyter server extensions, Home Assistant | Control-plane generations |
| Out-of-process plugin code | Dagster code locations, Jupyter kernels, LSP servers | Appendix A |

## Chosen direction

### Responsibilities

| Concern | Now (stage 0) | Target |
|---|---|---|
| Declaring task requirements: pip strings, merging, `graph2job` | earthkit-workflows | earthkit-workflows (unchanged) |
| Plugin convention: execution dependencies as extras, referenced with the plugin's installed version | Forecast-in-a-Box (fiab-core helper) | Forecast-in-a-Box |
| Known-good sets | Forecast-in-a-Box, implicitly: a freeze of the current, history-dependent venv | Forecast-in-a-Box, derived from the installation; the execution KGS is passed to earthkit-workflows as job-level constraints |
| Realising execution environments: constraints, resolution cache, serving tasks, grouping, shared environments, diagnostics ([E1-E9](#requirements-on-earthkit-workflows)) | Workers install on demand; Forecast-in-a-Box stopgap (`requires_new_worker`) | earthkit-workflows |
| Preparing environments ahead of runs | Not available | Forecast-in-a-Box triggers, earthkit-workflows executes |
| Location of environment caches and scratch | `CASCADE_VENV_ROOT` env var | Forecast-in-a-Box configures (from deployment configuration, D5), earthkit-workflows uses |
| Control-plane environment and its generations | Forecast-in-a-Box | Forecast-in-a-Box |
| Governance: published targets, conformance kit | Not available | Forecast-in-a-Box, deferred ([Appendix C](#appendix-c-governance-deferred)) |

The dependency direction stays from Forecast-in-a-Box to earthkit-workflows. earthkit-workflows sees only pip requirement strings, constraints, and requests to prepare environments; it never learns about plugins, extras as profiles, or known-good sets.

### Terms

- **Known-good set (KGS):** pinned versions within which plugins and execution environments must install. There are two, with different scopes (below). Both are derived from the installation, not published.
- **Requirement set:** the merged list of pip requirement strings of one task, as earthkit-workflows computes it today.
- **Pinned result:** the fully pinned versions resolved for a requirement set, or for a group of compatible sets, under given constraints. earthkit-workflows caches pinned results internally; tasks carry requirement sets, never environment identifiers.

### Known-good sets

| | Control-plane KGS | Execution KGS |
|---|---|---|
| Content | The package set of the application's own installation, as the deployment installed it, unaffected by plugins (D1) | The exact versions that pickled payloads require: Python, cloudpickle and earthkit-workflows, as used by the running backend |
| Applies to | Building each control-plane generation: the application plus every plugin's base dependencies | Every execution environment, as job-level constraints |
| Why this scope | The control plane is a single environment, so plugins must fit the application. Taking the plugin-free package set, rather than the running environment, keeps each generation independent of earlier plugin choices (G1) | Task functions and their static inputs are cloudpickled by the running backend; without these exact versions a worker cannot load them at all. Every other library only has to satisfy earthkit-workflows' own version ranges, which resolution already enforces |

Feasibility:

- Today plugins are installed into the application's own environment, so its plugin-free package set is not kept. D1 requires keeping it (or recording it at installation).
- The execution KGS must stay minimal. Pinning the whole dependency closure of earthkit-workflows to the backend's versions is not viable: it has about 70 packages, including numpy, pandas, xarray and protobuf, which the ML stacks of model checkpoints constrain themselves.

Neither set needs a release artifact. Publishing them as targets for plugin authors, and pinning further libraries, are part of the deferred governance ([Appendix C](#appendix-c-governance-deferred)).

### Plugin conventions

For plugin authors:

- **Base dependencies** are what the backend imports for `catalogue`, `validator`, `expander`, `compiler` and templates. They must be light and must install under the control-plane KGS.
- **Execution dependencies go into extras** in the plugin's `pyproject.toml`, one extra per capability, for example `fiab-plugin-ecmwf[mars]`, `[opendata]`, `[plotting]`, `[zarr]`. Each extra must resolve under the execution KGS. The `pyproject.toml` becomes the single place where a plugin declares its dependencies.
- **Blocks reference a set of extras of their own plugin.** fiab-core turns the set into a standard pip requirement string for the plugin with those extras, pinned to the installed plugin version (for example `fiab-plugin-ecmwf[plotting,mars]==7.1.0`; editable installs are referenced by path). The empty set means the plugin's base and is the default, replacing today's `base_environment`. The string is an ordinary task requirement, so **current cascade accepts it unchanged**, and the version pin keeps workers on the same plugin version as the control plane.
- **Requirement sets defined elsewhere are passed through unchanged.** A block that needs a model checkpoint's constraints, or that uses an upstream earthkit-workflows library declaring its own requirements, does not restate them as extras; earthkit-workflows merges them with the block's reference as it does today.
- **Extras are fine-grained by capability.** Grouping compatible sets is done by earthkit-workflows (target stage), so there is no benefit in coarse extras.
- **Pins already in a KGS are not repeated.** Plugins declare ranges; the KGS pins.
- **Plugins declare the minimum fiab-core minor** they need, not only the major. For in-repo plugins, CI tests against that minimum. For external plugins, that check belongs to the deferred governance.
- **Task output types are declared precisely** (no `Any` where avoidable), since diagnostics for data crossing environments rely on them ([Serialisation across environments](#serialisation-across-environments)). Types that plugin authors expect to cross conflicting environments, such as inference outputs, should preferably have a serialisation independent of library versions (for example GRIB bytes or Arrow).

While all plugins live in this repository, these conventions are enforced by review and by the repository's CI. There is deliberately no shared namespace of extras across plugins. Compatible requirement sets of different plugins end up in one environment without any coordination between their authors (G7).

### Execution environments

These are realised by earthkit-workflows, in stages. Forecast-in-a-Box's role is the same at every stage: supply constraints, trigger preparation, record what was used.

**Serving a task.** Tasks carry only their requirement sets, as `TaskDefinition.environment` does today; they carry no environment identifiers. A worker holds an environment, minimal when the worker starts, together with the requirement sets it has served and the versions it has installed. For each task, the worker:

1. **serves** it, if the task's requirement set is contained in the sets already served, or every requirement is satisfied by an installed version;
2. otherwise **extends** its environment, if the task's requirements and their dependencies can be installed at versions that agree with everything already installed. Nothing installed changes version, so no restart is needed;
3. otherwise **restarts** into an environment that serves the task: a fresh minimal one, or a prebuilt one from the cache.

The scheduler applies the same order when assigning tasks: it prefers a worker that can serve the task, then one that can extend, and restarts a worker only when neither exists. This generalises `requires_new_worker`.

Requirement sets are compared in a normalised form, so that equivalent requirements written differently compare equal. Set inclusion is the fast path; checking each requirement against installed versions covers requirements already satisfied indirectly, for example by a package present as a dependency of another. Both checks are cheap compared to installing anything.

What distinguishes the stages is where the versions for extending come from.

**Stage 0: no change in earthkit-workflows.** Plugins use the extras convention. Workers keep installing requirement sets on demand, so environments are not yet deterministic and conflicts are still detected late. As a stopgap, Forecast-in-a-Box can set `requires_new_worker` in its post-processing for tasks whose requirement sets it knows to conflict with others in the job (for example inference with different checkpoints), at the price of a worker restart per such task.

**Stage 1: small, generic changes.**

- Job-level pip constraints, applied to every worker install including the worker base (E1). Forecast-in-a-Box passes the execution KGS, which aligns cloudpickle and earthkit-workflows in workers with the backend.
- A resolution cache: each distinct normalised requirement set is resolved once, under the job's constraints and for the host's Python version and platform, into fully pinned versions (E2). The cache is internal to earthkit-workflows.
- Workers serve, extend or restart as above, comparing requirement sets in normalised form and installing only versions from the pinned results (E3, E4). Each task then runs with its own requirements at their pinned versions, regardless of task order (G4), and each requirement set is resolved once (G3).
- The job result reports the pinned versions each worker used, so Forecast-in-a-Box can store them in the run record (E5).

Limitation: two compatible sets resolved separately may pin different versions of a package they share, which forces a restart that a joint resolution would have avoided.

**Stage 2: generic environment machinery.**

- **Joint resolution upfront, installation on demand (E6).** Before a job starts, its distinct requirement sets are grouped into maximal compatible groups, and each group is resolved jointly, which fixes the version of every package in the group. Workers still start minimal and extend on demand, but take versions from their group's pinned result, so extending never conflicts within a group and restarts happen only across genuine conflicts (G5). A worker stays eligible for every group whose pinned versions agree with what it has installed, so a task that fits several groups does not force an early choice. The grouping result is cached, so repeated runs do not regroup. Feasibility: uv can resolve compatible and conflicting groups together in one lock ([Appendix B](#appendix-b-observed-uv-behaviour)).
- **Shared prebuilt environments (E7).** A group's full environment can be materialised once per host, or once on shared storage, and used read-only by workers. It serves every task of its group, so a worker using it never extends and restarts only for tasks outside the group. Private minimal environments and shared prebuilt ones can coexist; which is used is a policy per deployment, possibly per group (large ML stacks favour sharing). On remote infrastructure, each node materialises from the pinned result or uses shared storage; staging of the earthkit-workflows wheel folds into the same mechanism.
- **An API to prepare environments ahead of jobs** for given requirement sets and constraints (E8).
- **Diagnostics for data crossing environments** (E9, [below](#serialisation-across-environments)).

Which parts of stage 2 belong in earthkit-workflows, and in what shape, is a cross-project decision ([open question](#open-questions)). Whether group environments are built upfront or grow on demand, and when they are shared, should be decided by measurement ([open question](#open-questions)).

**Preparing environments ahead of runs (Forecast-in-a-Box triggers).** Using the stage 2 API, or by submitting a trivial job at stage 1:

- on plugin install or update: the plugin base and each declared extra;
- on model checkpoint download: the checkpoint's constraint set together with the requirements of the blocks that use it;
- optionally after a run: nothing, since the cache already holds what the run used.

### Serialisation across environments

Two kinds of data cross from the backend to workers, or from one environment to another:

- **Task functions** cloudpickled by the backend. They can only be loaded with the same Python, cloudpickle and earthkit-workflows versions, which the execution KGS guarantees from stage 1 (cascade already matches the Python version).
- **Data objects**: task outputs passed between environments, and data in static inputs passed from the backend. Their compatibility depends on the libraries that produced them. Mature libraries generally keep pickles loadable across minor versions, more reliably from older to newer than the reverse; major versions are where breakage may happen, depending on the type. Since pickles do not record the producing library version, compatibility cannot be checked reliably in advance, and requiring identical versions would be needlessly strict.

The design therefore makes failures rare and easy to diagnose rather than trying to predict them:

1. **Rare by construction.** Within a group of compatible requirement sets, versions are identical; different versions meet only at genuine conflicts, mostly between model inference stacks.
2. **Clear failures at run time (E9).** A payload carries the producing environment's version of the distribution that provides the output type. If loading it fails, the error names the edge, the type and both versions.
3. **An optional warning when planning a job (E9)** for edges between conflicting environments whose output type's distribution differs in major version. It informs and never rejects.
4. **Stable serialisation by convention** for types plugin authors expect to cross conflicting environments ([Plugin conventions](#plugin-conventions)).

Pinning major-version ranges of common data libraries in the execution KGS is left to the deferred governance, if failures show up in practice ([Appendix C](#appendix-c-governance-deferred)).

### Control-plane environment and plugin lifecycle

- The control-plane environment is the application as the deployment installed it (D1), plus the base dependencies of every installed plugin, built under the control-plane KGS.
- A plugin install, update or removal builds a new **generation** of the control-plane environment from the installed application and the desired plugin list, never from the previous generation, so the result does not depend on installation history (G1). The generation is validated (its dependencies are consistent, every plugin imports, templates compile) and then activated by **restarting the backend**. The previous generation is kept for rollback.
- No package is ever installed into the running backend's environment.
- The desired plugin state is the authoritative input, as in [plugins-candidate_venvs.md](plugins-candidate_venvs.md). Generations and validation from that spec carry over; its backend handover and the related process-wide concerns are dropped.
- A generation that changes plugin versions can affect saved blueprints. This follows the migration decision of [ci-fiab_core.md](ci-fiab_core.md) (record the versions a blueprint was saved with, warn on mismatch); this design adds no block-level migration.
- Activating a generation triggers preparation of the plugins' execution environments ([above](#execution-environments)).
- Live migration without a restart can be added later if needed. A single separate plugin host ([Appendix A](#appendix-a-plugin-hosts-deferred)) would make it considerably simpler than a backend handover.
- Where generations are stored and how the active one is started is left up to the deployment (D2, D3). How this works in containers is an [open question](#open-questions).

### Testing and release

The same mechanisms define the test environments, which removes the divergence between development, release and production (problem 8):

- A plugin release is tested in a control-plane environment built from the targeted Forecast-in-a-Box release plus the plugin, and its execution tests run in an environment for each extra, resolved under the execution KGS derived from that release.
- A plugin release also includes fiab-core if fiab-core has changed since its last release, so that what CI tested together is what users install together.
- Forecast-in-a-Box's own CI tests its bundled plugins the same way.
- The artifact catalog's existing CI check also checks that each checkpoint's constraint set resolves under the execution KGS.
- A scheduled job resolves the bundled plugins and the artifact catalog against the development version, so that pin changes surface before a release instead of during it.

## Requirements on earthkit-workflows

None of these involve Forecast-in-a-Box concepts.

| # | Requirement | Stage |
|---|---|---|
| E1 | Job-level pip constraints, applied to all worker installs including the worker base | 1 |
| E2 | Resolution cache: each normalised requirement set resolved once per constraints, Python version and platform | 1 |
| E3 | Workers serve, extend or restart, installing only pinned versions; the scheduler prefers workers that can serve, then extend | 1 |
| E4 | Comparison of requirement sets in normalised form | 1 |
| E5 | Job results report the pinned versions each worker used | 1 |
| E6 | Grouping of compatible requirement sets within a job, resolved jointly, cached by the job's set of normalised requirement sets | 2 |
| E7 | Shared prebuilt group environments per host or on shared storage, also on remote infrastructure; configurable location | 2 |
| E8 | An API to prepare environments for given requirement sets and constraints ahead of jobs | 2 |
| E9 | Diagnostics for data crossing environments: payloads record the producing version of the output type's distribution, failures name edge, type and versions; optional planning-time warning on major-version differences | 2 |

## Requirements on deployment

How Forecast-in-a-Box is installed, upgraded and run is designed separately. This design works with any deployment that provides the following. A deployment that cannot provide D2 or D3 (for example an immutable container image) disables runtime plugin changes instead; plugins are then installed when the deployment is built.

| # | Requirement | Used for |
|---|---|---|
| D1 | The application's own installation is not modified by plugin changes, or its package set is recorded when it is installed, so the plugin-free package set remains available as the base for building generations | The control-plane KGS |
| D2 | A writable location for control-plane generations, and a way for the application, however it was installed, to start the backend in the active generation | Plugin changes without mutating the running environment |
| D3 | Something that restarts the backend when a generation is activated: a service manager, a container restart policy, or the application's own entry point relaunching itself | Activating generations |
| D4 | The desired plugin list is persistent state that survives application upgrades, and generations are rebuilt from it when the application version changes | Keeping plugins across upgrades |
| D5 | Configurable, exec-mountable locations for the execution environment cache and for worker scratch space, passed to earthkit-workflows | Execution environments |
| D6 | Package sources for execution environments on hosts without access to PyPI (earthkit-workflows' `custom_pip_indices` already supports extra sources) | Offline and air-gapped deployments |

## Work packages

In suggested order. Sizes are relative (S, M, L, XL) and indicate effort, not duration; they exclude cross-project coordination.

| # | Work package | Covers | Owner | Size | Long-term effect |
|---|---|---|---|---|---|
| 1 | Plugin conventions: extras helper, ecmwf requirement lists moved into extras, output types declared | G6, stage 0 | fiab-core, plugins | S | Dependencies declared in one place; little code either way |
| 2 | Control-plane generations built from the installed application and desired plugins, activated by restart; installs into the running backend retired | G1, G8, D1-D4 | backend | M | Net simplification: replaces in-process install and reload, the most fragile part of plugin handling, and the much larger handover of [plugins-candidate_venvs.md](plugins-candidate_venvs.md). Largely independent of deployment changes: the backend is already started from a parent process (D3). D1 needs the plugin-free package set recorded at installation, since today's release lock does not pin fiab-core |
| 3 | earthkit-workflows stage 1, and passing constraints and recording pinned versions in Forecast-in-a-Box | E1-E5, G2-G4 | earthkit-workflows, backend | M | A generic resolution cache and stricter, pinned worker installs; deterministic, recorded environments. The hardest parts are sharing the cache across workers and hosts and making the scheduler aware of worker environments |
| 4 | Run-time diagnostics for data crossing environments | E9 (run-time part) | earthkit-workflows | S | Small; can come with package 3 |
| 5 | earthkit-workflows stage 2 and preparation triggers | E6-E8, E9 (warning), G5 | earthkit-workflows, backend | L | A substantial subsystem with operational surface (shared caches, remote materialisation, garbage collection). Prototype and measure first ([open question 8](#open-questions)) |
| - | Stage 0 stopgap | G2 | backend | S | Throwaway; only if checkpoint conflicts hurt before package 3 |
| - | Governance ([Appendix C](#appendix-c-governance-deferred)) | G6 | maintainers, fiab-core | M | Mostly process; triggered by the first plugin developed outside this repository |
| - | Plugin hosts ([Appendix A](#appendix-a-plugin-hosts-deferred)) | live plugin changes | backend, fiab-core | L | A versioned protocol to maintain; triggered by a need for live plugin changes |

Packages 1 and 2 are independent of earthkit-workflows and give most of the benefit to Forecast-in-a-Box. Package 3 needs agreement with the earthkit-workflows maintainers. Package 5 should be decided on measurements.

## Open decisions

- **Format of resolved environments and uv on workers.** Whether earthkit-workflows stores pinned results as `pylock.toml` files, a uv lock, or plain pinned lists, and whether workers, including remote ones, may require uv to install them. A single `pylock.toml` cannot represent several conflicting environments ([Appendix B](#appendix-b-observed-uv-behaviour)). This is now largely an earthkit-workflows decision; Forecast-in-a-Box only needs the pinned results reported in a form it can store. Deliberately left open.

## Open questions

1. **Plugins in containers.** Either plugins are baked into the image (or a derived image) and runtime plugin changes are disabled, or plugin generations and execution environments live on mounted volumes, which keeps container and non-container installations closer. Possibly both, as a deployment option. With generations on a volume, a generation contains the application itself, so it must be rebuilt when the image's application version changes. Depends on what container deployments can provide for D2 and D3.
2. **Stage 2 in earthkit-workflows.** Whether, where and in what shape; a cross-project decision.
3. Is the stage 0 stopgap (`requires_new_worker` for known conflicting sets) worth implementing, or should Forecast-in-a-Box wait for stage 1?
4. For the optional planning-time warning (E9), how is an output type mapped to its distribution without importing every environment's packages?
5. Should a block be able to reference extras of another plugin's distribution, or only its own?
6. Requirement sets with platform-specific direct wheel URLs (as some checkpoints have) are valid only on matching hosts. Should the artifact catalog declare supported platforms, so that unsupported combinations are rejected at compile time?
7. Which combinations of extras are prepared ahead of runs: each extra on its own, or also combinations observed in templates?
8. Should group environments be built upfront, grow on demand, or be shared prebuilt, and for which groups? To be decided by measurement, ideally on a prototype in earthkit-workflows: grouping time for typical jobs, install time of a whole group compared to a task's subset from a warm cache, worker restart cost including heavy imports, and disk use of prebuilt environments.

## Appendix A: plugin hosts (deferred)

Plugin control-plane code would run outside the backend process and serve `catalogue`, `validator`, `expander`, `compiler` and templates to the backend. The backend's plugin manager would gain an out-of-process loader with the same interface as the in-process one.

**Variants:**

| Variant | Environments | What it buys |
|---|---|---|
| Single shared host: all plugins in one separate process | One plugin environment (still constrained by the control-plane KGS); the backend environment no longer contains plugins | Plugin changes restart only the host, not the backend. Live migration becomes starting a new host generation, switching to it and stopping the old one, much simpler than a backend handover. The backend environment can stay identical to the installed application, so a container image could hold the backend while the plugin host's environment lives on a volume |
| One host per plugin, or per group of compatible plugins | One environment per host | Removes co-installation constraints from the control plane; plugin developers can run a host from their own environment (as Dagster's `executable_path` does for code locations) |

The single shared host is a half-way step towards per-plugin hosts and uses the same protocol.

**Transport.** Local IPC (stdio or a Unix socket) first. REST over the network would allow hosts on other machines, for which there is no clear need yet. If messages are designed independently of the transport (request and response payloads, a version handshake), switching transports later is cheap.

**Costs:**

- fiab-core becomes a versioned wire protocol, not only a Python API, with a handshake and a supported version range;
- compile output must be serialisable. It reduces to cascade `TaskDefinition`s, which already are, but this has to hold for every block. Entrypoint references are robust; cloudpickled functions need the host's cloudpickle and Python to match the workers', which the execution KGS already requires;
- hosts must produce graphs for the backend's earthkit-workflows version;
- process management: lazy start, idle shutdown, restart on failure;
- latency for validation during blueprint editing, to be measured.

Revisit if live plugin changes become a requirement (single host first), if plugins that cannot fit the control-plane KGS become common, or if multi-user deployments need per-user plugins without per-user backends.

## Appendix B: observed uv behaviour

Relevant to grouping compatible requirement sets (E6). With uv 0.12.23, a project whose dependency groups conflict pairwise (for example `packaging==23.2` in one, `packaging==24.1` in another) fails to lock unless the conflict is declared in `tool.uv.conflicts`; once declared, a single lock forks only where needed. Non-conflicting groups share versions, any non-conflicting combination can be exported as one environment (also as `pylock.<name>.toml`), and combinations containing a conflict are refused, as is exporting all groups into one `pylock.toml`. Constraints apply to every group, and relocking without an explicit upgrade keeps existing versions. A dependency shared by two forks happened to resolve to the same version on both sides, which uv does not guarantee.

Dependency groups and `tool.uv.conflicts` are not part of published package metadata, which is one reason grouping belongs with the execution engine, which sees a job's actual requirement sets.

## Appendix C: governance (deferred)

With few plugin authors, all of them working in this repository, the conventions above are enforced by review and CI. Governance becomes necessary once plugins are developed and released independently, in particular by other organisations. It would then cover:

- **Published known-good sets.** Both sets published with each release (in a form usable as pip constraints), so that plugin authors have a target to test against. This needs the release pipeline to publish them, which is the only point where governance would put a requirement on deployment.
- **The scope of the execution KGS.** Whether to pin, beyond the mandatory part, major-version ranges of common data libraries (for example numpy, pandas, xarray), if serialisation failures across environments occur in practice, and how this fits model checkpoints that constrain some of them themselves. Pinning more makes conflicts and serialisation failures rarer but ties plugin authors, and model checkpoints, to Forecast-in-a-Box's choices; pinning less frees them but makes conflicting environments, and data passed between them, more common.
- **An update process for the KGS.** Plugin authors request pin changes through an issue template; updates follow a stated cadence aligned with releases; pin changes that can break plugins follow the same major-version policy as fiab-core.
- **A conformance kit** shipped in fiab-core (for example `fiab_core.testing` fixtures and a `check` command), versioned with the contract it checks. It would verify that the base imports with only base dependencies installed, that every extra resolves under the execution KGS of the targeted release, that blocks reference only declared extras, that output types are declared, and that the plugin's templates compile.
- **A reusable CI workflow and a repository template,** thin wrappers calling the conformance kit over a matrix of releases, including a canary against the next release's KGS. The workflow stays thin because plugin authors may use CI systems other than GitHub Actions.
- **Plugin stores** running the conformance kit centrally against each release and publishing compatibility metadata. [ci-fiab_core.md](ci-fiab_core.md) considered such an external compatibility matrix and rejected it for its overhead, relying on wheel metadata and trusted registration in `plugins.json` instead; it should only be reconsidered if that proves insufficient.
- **A plugin author guide** in `docs/`: base vs extras, extras granularity, referencing extras from blocks, passing through checkpoint and library requirements, not repeating KGS pins, declaring output types and serdes, using the conformance kit, and the fiab-core version policy.

Revisit when the first plugin is developed or released outside this repository.

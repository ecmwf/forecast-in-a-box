# Plugin Installation Immediate Hardening

## Purpose

Harden runtime plugin installation without changing the current shared-virtual-environment architecture.

Today, `domain/plugin/compatibility.py` protects only the installed `fiab-core` version when it invokes `uv pip install`. A plugin can therefore cause `uv` to upgrade or downgrade any other installed distribution. This can invalidate modules already loaded by the backend and can leave the environment broken for the next backend start.

Replace that narrow protection with a snapshot of the complete installed environment. Every existing distribution other than the plugin being installed or updated must be presented to `uv` as either:

- an exact version constraint; or
- its existing editable or local source requirement.

`uv` must resolve the requested plugin against this snapshot in a dry run before the real installation is attempted.

This is an immediate risk reduction, not the final plugin-environment architecture. The backend will still modify its active virtual environment and reload Python modules after installation. The limitations of that model must be explicit in the code.

## Required behavior

For a plugin install or update:

1. Construct the requested plugin requirement using the existing version policy.
2. Freeze the environment used by the running backend.
3. Classify frozen entries into ordinary pinned distributions and editable/local source installations.
4. Remove the selected plugin distribution from both groups so that it is allowed to change.
5. Write ordinary exact pins to a temporary constraints file.
6. Add preserved editable/local installations as explicit command-line requirements.
7. Run the complete `uv pip install` command with `--dry-run`.
8. Check the dry-run process result. Do not run the real installation if resolution failed.
9. Run the same command without `--dry-run`.
10. Preserve the current error reporting and installed-version parsing contract.
11. Continue through the existing plugin cache invalidation/reload and loading flow.

The effective command should resemble:

```text
uv pip install \
    --python <running-backend-interpreter> \
    --constraints <temporary-constraints-file> \
    --dry-run \
    <preserved-editable-or-local-requirements...> \
    <requested-plugin-requirement>
```

The real command must differ only by omission of `--dry-run`. Do not allow options, sources, or requirements to drift between preflight and installation.

Use argument arrays with `subprocess.run`; do not construct a shell command.

## Scope and module boundaries

### `forecastbox.utility.packages`

Put environment and package-command utilities in `backend/src/forecastbox/utility/packages.py`. They must not depend on plugin-domain types or policy.

The implementation should provide small, independently tested operations equivalent to:

- freeze the selected Python environment with `uv pip freeze`;
- parse and classify freeze output;
- normalize distribution names according to Python packaging rules;
- remove a selected distribution from a frozen environment snapshot;
- extract editable and local source requirements from the snapshot;
- render the remaining ordinary entries as a constraints file;
- execute an install dry run;
- execute the real install;
- optionally execute `uv pip check` without embedding plugin policy in the utility layer.

Names such as `freeze_environment`, `freeze_to_constraints`, `extract_editable_local_requirements`, and `exclude_distribution` are suggestions only. Prefer typed dataclasses for intermediate results over loosely related tuples or lists. For example, a parsed snapshot should retain the normalized distribution identity alongside the exact constraint or source arguments needed to reproduce the installation.

Keep subprocess handling centralized. Dry-run and real installation should use one command builder and one result/error translation path so they cannot accidentally acquire different semantics.

### `forecastbox.domain.plugin.compatibility`

Keep plugin-specific decisions in `backend/src/forecastbox/domain/plugin/compatibility.py`:

- determine the plugin requirement from `pip_source`, the requested version, and the installed `fiab-core` major version;
- identify which installed distribution is the selected plugin;
- obtain and transform the environment snapshot using package utilities;
- exclude the selected plugin;
- create and clean up the temporary constraints file;
- arrange dry-run, checks, and real installation;
- return the existing `Either[dict[str, str], str]`-style result expected by the manager, unless the surrounding API has deliberately changed by implementation time.

Replace the current `install_plugin_compatibly` implementation rather than layering the new behavior around its single `fiab-core` pin. Retaining the public function name is acceptable if it minimizes call-site churn, but its implementation and documentation must describe environment-wide preservation.

Do not move package parsing, subprocess mechanics, or temporary-file rendering into the plugin manager.

### `forecastbox.domain.plugin.manager`

Keep manager changes narrow. It should continue to coordinate one plugin operation at a time, update persisted state, invalidate import caches, reload/load the plugin, and report errors. Do not use this task to redesign plugin process isolation or updater concurrency.

## Freeze and constraint construction

### Select the correct interpreter

All `uv` commands must explicitly target the interpreter running the backend, normally `sys.executable`, via `--python`. Do not rely on current-working-directory virtual environment discovery. The backend can be launched from a directory unrelated to its installed environment.

### Ordinary installed distributions

An ordinary frozen entry such as:

```text
pydantic==2.12.0
```

must become an entry in the constraints file. Constraints are appropriate because they do not themselves request installation, but they restrict any matching transitive dependency selected for the plugin.

Pin every representable installed distribution, not only imported modules and not only Forecastbox dependencies. An unimported package may be used after the installation or by another plugin on the next backend start.

Preserve markers when `uv pip freeze` emits them. Parse requirements with `packaging`, not ad hoc splitting on punctuation. Normalize names with `packaging.utils.canonicalize_name` or equivalent behavior.

### Editable and local installations

Freeze output can contain editable or direct/local sources, for example:

```text
-e file:///workspace/fiab-core
some-package @ file:///wheelhouse/some_package.whl
```

Editable requirements cannot be represented as ordinary version constraints. Preserve them as explicit requirements in both the dry-run and real commands. Correctly retain multi-argument forms such as `-e <path>` as two subprocess arguments and PEP 508 direct references as one requirement argument where appropriate.

The utility code must recognize at least:

- `-e PATH` and `--editable PATH`;
- `file://` direct references;
- PEP 508 `name @ file://...` references;
- local directory or wheel references emitted by the supported `uv` version.

Use installed distribution metadata, including `direct_url.json` or `Distribution.origin` where available, to associate a local source with its normalized distribution name. Do not assume that a source directory basename equals the distribution name.

If a frozen local/editable entry cannot be associated with a distribution identity, fail closed with a useful error unless it can be proven irrelevant. Silently dropping it would allow `uv` to replace the local installation from an index. Silently keeping it could prevent updating the selected plugin.

### Exclude the selected plugin

The existing installation of the selected plugin must be removed whether it appears as:

- an ordinary `name==version` pin;
- an editable installation;
- a local directory installation;
- a direct wheel or `file://` installation.

Exclusion must use the distribution name, not the import module name. `module_name` is not a reliable package identity.

For registry requirements, the name can normally be parsed from `pip_source`. For local, editable, URL, or VCS sources, determine the distribution name from installed metadata when updating an existing plugin. For a first installation there is no existing entry to remove. If the current configuration does not provide enough information to identify an already-installed target safely, introduce an explicit distribution-name field or a focused metadata-resolution helper rather than guessing from `module_name`.

Do not remove similarly named packages. Compare canonical names exactly.

### Temporary file handling

Use a securely created temporary file or temporary directory with deterministic cleanup. Write UTF-8 text with one constraint per line and a final newline. Keep the file alive across both dry-run and real installation.

Log the path and a safe summary at debug level. Avoid logging credentials embedded in package index or source URLs.

An empty constraints file is valid when the environment contains no ordinary protected distributions.

## Resolution and checks

### Baseline environment check

Run `uv pip check --python <interpreter>` before attempting installation, or otherwise record the equivalent baseline. A broken starting environment must not be confused with damage caused by the requested plugin.

Refuse plugin installation when the existing environment is inconsistent

The active development workspace may contain editable or deliberately mismatched packages, so tests must mock this command.

### Dry-run check

Run the exact install request with `--dry-run`. A non-zero exit is an installation failure and must be returned through the existing plugin installation error path. Include enough stderr/stdout context for the user to understand which frozen package conflicts with the requested plugin.

The constraints are the safety mechanism. Do not make correctness depend on parsing the human-oriented dry-run plan. It is acceptable to inspect or log the plan, but a successful dry run plus complete constraints should structurally prevent protected distributions from changing.

Do not use `--no-deps`; dependencies absent from the current environment must still be resolved and installed.

Do not treat `--strict` as prevention. It validates after an operation and does not provide rollback.

### Real installation and post-check

If and only if the dry run succeeds, run the same constrained request for real. Parse installed versions from the real command only; dry-run output must not be reported as an installation.

After a successful real command, run `uv pip check` again before loading the plugin. Report a failure prominently. Be explicit that this is detection, not rollback: an installer or filesystem failure, a file collision, or an unexpected `uv` behavior may already have changed the environment.

If package output parsing currently depends on stderr markers such as `+ package==version`, retain tests against the supported `uv` version. Keep parsing isolated because CLI presentation can change between `uv` releases.

## Reload behavior

After the real installation and checks succeed, retain the current cache invalidation and plugin reload/load behavior for this immediate task. Ensure `importlib.invalidate_caches()` occurs before attempting to import newly installed modules if it is not already guaranteed by the call path.

Do not claim this makes in-process upgrades safe. Reloading the plugin's top-level module does not reload all plugin submodules or dependencies, replace previously imported symbols, update existing class instances, or safely reinitialize extension modules and global registries.

A restart remains the only reliable way for one interpreter to observe a coherent set of installed modules. The follow-up candidate-venv design is intended to remove this limitation.

## Required module documentation

Expand the module-level docstring in `backend/src/forecastbox/domain/plugin/compatibility.py`. It must document the algorithm and at least the following caveats:

1. The policy is deliberately stricter than theoretical dependency compatibility. It preserves all existing distributions. A different plugin installation order, or resolving several plugins together in a fresh environment, could produce a valid state that an incremental install rejects.
2. Plugin uninstall currently removes the configured/loaded plugin but does not uninstall its distribution or dependencies. Packages introduced by a plugin become part of later environment snapshots and are consequently protected. The system cannot reliably infer which packages are now unused because dependencies may be shared by the backend or other plugins.
3. In-process reload is incomplete. Already imported plugin submodules, dependencies, symbols, instances, extension modules, registries, and side effects may continue to reflect old code until the backend restarts.
4. Dry-run and constraints prevent resolver-approved version replacement of protected distributions, but do not provide a filesystem transaction or rollback. Installation interruption, colliding files, `.pth` behavior, installer bugs, and malicious packages remain possible.
5. A newly added distribution can expose a top-level module that collides with an existing distribution even though no existing distribution version changed.
6. Plugins are arbitrary trusted Python code when built or imported. Compatibility checking is not a security sandbox.
7. A dry run and real run are separate resolver executions. Using identical constraints limits the allowed changes, but mutable indexes or direct sources can still change between executions.
8. Repeated single-plugin installation is order-dependent and can leave unnecessary transitive packages installed. This hardening intentionally accepts that limitation until complete candidate environments are implemented.

Also link from the docstring or an adjacent comment to `docs/developer/changeSpecs/plugins-candidate_venvs.md` as the intended architectural successor, using the repository's established documentation-link style.

## Error handling and observability

Preserve the current rule that package utility failures do not escape unexpectedly from `install_plugin_compatibly`. Convert failures into the domain's existing error result with stage context:

- freeze failed;
- freeze parsing or target identification failed;
- baseline check failed;
- dry-run resolution failed;
- installation failed;
- post-install check failed.

Log full command argument arrays only after redacting credentials. Include the interpreter and constraints snapshot summary in debug logs. Include resolver stderr in the persisted plugin installation error, subject to reasonable size limits if the existing persistence layer requires them.

Do not continue to real installation after any preflight failure. Do not reload after a failed real installation or failed post-check.

## Concurrency

The current plugin manager serializes pip/importlib operations. Preserve and verify that assumption. Freeze, dry-run, real installation, post-check, and reload must all occur within one serialized plugin update operation. If another package mutation can occur outside the plugin manager, either bring it under the same coordination mechanism or detect that the environment changed between snapshot and install.

Do not add an independent utility-level global lock. Coordination belongs to the caller/domain layer.

## Tests

### Utility unit tests

Add focused tests in `backend/tests/unit/utility/test_packages.py` or split the test module if it becomes unwieldy. Cover:

- ordinary freeze entries become exact constraints;
- canonical name matching across hyphen, underscore, dot, and case differences;
- the selected ordinary distribution is removed;
- the selected editable distribution is removed;
- unrelated editable and local distributions become correctly tokenized CLI arguments;
- PEP 508 file references are preserved;
- paths containing spaces are passed as one subprocess argument where required;
- markers are preserved;
- blank lines and comments are handled;
- malformed or unidentifiable local entries fail closed;
- temporary constraints content and cleanup;
- explicit `--python` selection;
- dry-run and real commands are identical except for `--dry-run`;
- dry-run failure prevents the real subprocess call;
- only real install output contributes installed-version results;
- `uv` missing and subprocess failures retain useful errors.

Avoid mocking so deeply that command construction and argument tokenization are untested.

### Compatibility unit tests

Update `backend/tests/unit/domain/plugins/test_compatibility.py` to cover orchestration:

- default plugin major-version requirement is retained;
- exact requested plugin version is retained;
- the target is excluded from the frozen snapshot;
- every other ordinary distribution is constrained;
- local/editable protected requirements are included;
- local/editable target updates do not preserve the old target source;
- baseline-check, freeze, dry-run, real-install, and post-check failures stop at the correct stage;
- temporary files are cleaned on success and every failure path;
- no reload or manager behavior is pulled into the compatibility module.

### Integration tests

There isn't much plugins coverage in integration tests, hence your work should not make any changes there.

## Acceptance criteria

The task is complete when:

- installing or updating one plugin cannot cause `uv` to upgrade or downgrade any other representable installed distribution;
- existing editable and local installations are preserved as their current sources;
- the selected plugin is correctly exempted regardless of its current installation form;
- no real installation runs unless a baseline policy and constrained dry run succeed;
- the real install uses exactly the preflight constraints and requirements;
- package consistency is checked after installation before plugin reload;
- current plugin manager result reporting remains functional;
- the `compatibility.py` module docstring clearly records all limitations above;
- unit tests cover conflict rejection and source preservation;
- integration tests pass without change;
- `uv run prek` and the relevant backend validation commands pass.

# Plugin Candidate Virtual Environments

## Purpose

Replace mutation of the running backend's Python environment with validated environment generations and a near-zero-downtime backend handover.

This document is an architectural direction rather than an implementation-ready plan. It assumes the immediate environment-freezing hardening described in `plugins-immediate_hardening.md` has already been implemented, but the repository may otherwise have changed substantially by the time this work starts. Reconfirm all process, gateway, status, persistence, and plugin-manager assumptions before designing the final solution.

The central rule is:

> Never install a plugin into the environment of the backend process currently serving users.

Instead, a plugin state change produces a complete candidate environment. The candidate is resolved, installed, validated, and used to start a second backend. Traffic moves only after the candidate backend is healthy. The old backend is then drained and stopped, with its environment retained temporarily for rollback.

## Desired outcome

A plugin install, update, removal, enablement change, or relevant Forecastbox upgrade should converge from one declared environment generation to another:

```text
released Forecastbox pylock
+ all currently desired plugins
+ the requested plugin state change
= candidate desired requirements
= resolved candidate pylock
= candidate virtual environment
= validated candidate backend
= active generation
```

Plugin installation becomes desired-state reconciliation rather than an in-place `pip install` operation.

## Scope

The design work should focus first on package resolution, reproducibility, candidate construction, validation, activation, and rollback.

A safe hot swap also depends on process-wide behavior that this document deliberately does not solve. Before implementation is accepted, architects must address:

- concurrent plugin install/update/uninstall route invocations;
- database and configuration writes during candidate construction;
- scheduler ownership and duplicate scheduling;
- in-memory caches and immutable manager snapshots;
- websocket and other long-lived clients;
- requests in flight during handover;
- artifact downloads, uploads, and background processing in progress;
- Cascade gateway and worker ownership;
- event-dispatcher work and thread pools;
- authentication/session behavior;
- ports, service discovery, and external reverse proxies;
- fencing the old process so both generations cannot perform singleton side effects;
- crash recovery if the coordinator or either backend dies during a transition.

These are crucial correctness concerns, not optional polish. They should be resolved as part of the eventual architecture, but should not obscure the initial package-environment design.

## Desired plugin state

Maintain an authoritative desired state containing every enabled or installed plugin, not only the plugin named by the current request. At minimum, each entry should provide:

- canonical distribution name;
- selected version or deliberate version policy;
- package source and index configuration;
- extras, if supported;
- import module name;
- plugin composite ID;
- enabled/disabled state;
- any trust or provenance information required by deployment policy.

When processing a request, derive a new immutable desired-state revision by applying the requested change to the currently active revision. Candidate construction must use that complete revision.

Do not derive the complete desired state solely from whichever packages happen to remain installed in the active venv. The immediate hardening intentionally leaves orphaned transitive dependencies after uninstall, and those must not silently become roots of the next generation.

For an existing plugin whose version was not changed, prefer its exact active version in the candidate input. Re-resolving every plugin as unconstrained latest during an unrelated install would make the operation unexpectedly broad and difficult to roll back.

## Base lock and candidate resolution

Use the released Forecastbox `pylock.toml` as the definition of the tested base application environment. Reconfirm by implementation time whether it should be treated as:

- an immutable set of exact constraints that plugins may only extend; or
- the preferred starting solution for a full re-resolution in which selected packages may move.

The safer default is an immutable base. A plugin that requires changing a base package should fail candidate resolution and require a deliberate Forecastbox environment upgrade. If product requirements demand controlled movement of base dependencies, make that a separately authorized operation with broader testing and an explicit change report.

Generate a candidate input from the base plus all desired plugin roots, then ask `uv` to perform one joint resolution. Do not resolve or install plugins sequentially. Joint resolution:

- detects conflicts between plugins;
- removes installation-order dependence;
- allows transitive packages no longer required by any root to disappear;
- gives one reproducible description of the candidate environment;
- lets index metadata and artifacts be shared through the `uv` cache.

Do not manually append package records to `pylock.toml`. A lock is a resolved artifact containing versions, markers, URLs, wheels, and hashes. Use `uv pip compile`, `uv lock`, or the supported equivalent at implementation time to generate a complete candidate lock from declarative inputs.

Candidate resolution should use the target production interpreter version and platform. Index URLs, credentials, trust policy, prerelease policy, binary/source policy, and marker behavior must match final installation. Prefer wheels and consider rejecting source distributions for runtime plugin changes unless there is a documented need for them.

Retain the generated candidate input, lock, resolver diagnostics, and a digest as generation metadata. Redact credentials before persistence or logging.

## Candidate environment construction

Create every candidate under a new generation-specific directory. Never reuse or modify the active venv. A generation might contain:

```text
generations/<generation-id>/
    desired-plugins.json
    pylock.toml
    venv/
    build-and-validation.log
    state.json
```

The exact layout is an implementation decision, but generation state should distinguish at least:

- resolving;
- resolution failed;
- installing;
- validating imports;
- starting candidate backend;
- health checking;
- ready for activation;
- active;
- draining;
- retired;
- failed;
- rollback candidate.

Create a fresh venv with the intended Python interpreter and install or sync the generated lock into it. Use `uv`'s cache and an appropriate copy-on-write, hardlink, or clone mode to keep candidate creation fast and storage-efficient, while ensuring that cleaning the cache cannot invalidate an active environment.

Installation should be exact: the candidate environment must contain what the candidate lock describes and should not inherit undeclared packages from the active generation. Run `uv pip check` against the completed candidate.

An interrupted candidate build must be disposable. Startup recovery should identify incomplete generations and either resume from a well-defined stage or delete and rebuild them.

## Package and plugin validation

Validation must happen using the candidate interpreter, not by adding the candidate site-packages directory to the active backend's `sys.path`.

At minimum, run a candidate-side validation program that:

1. imports Forecastbox and checks its version/generation metadata;
2. imports every configured plugin module;
3. verifies that the module exposes the expected `plugin` callable or attribute;
4. invokes it;
5. verifies that the result satisfies the candidate environment's `fiab_core.plugin.Plugin` contract;
6. performs lightweight catalogue and schema construction sufficient to detect import-time and registration failures;
7. emits a structured result associated with the candidate generation.

The exact plugin test should be finalized during this work. Avoid tests that execute real forecasts or require external services, but make the check stronger than merely finding the module spec. Plugin import and object construction are necessary because wheel metadata can establish dependency compatibility but cannot establish behavioral compatibility.

Treat plugin import as execution of trusted arbitrary Python code. Candidate environments provide operational isolation from the active venv, not a security sandbox. If untrusted plugins become a requirement, use a stronger process/container and permissions model.

## Candidate backend startup

After package and plugin validation succeeds, start the full backend from the candidate venv on a different internal port. The candidate must have a generation identity and must not yet accept externally routed traffic.

Poll the backend status endpoint and require a deliberately defined readiness condition. A TCP connection or `api: up` alone is insufficient. Readiness should eventually account for at least:

- plugin manager startup completed successfully;
- all desired plugins loaded at expected versions;
- catalogue/template initialization completed;
- database access is functional;
- required concurrency components reached a healthy state;
- any process that must remain singleton is either passive or correctly fenced during candidate warm-up.

The existing `/api/v1/status` endpoint is a starting point, not necessarily the final handover contract. Add a generation-aware readiness endpoint if necessary rather than overloading a status response whose semantics are too weak.

Use a bounded startup and health-check timeout. On failure, stop the candidate backend, mark the generation failed, retain useful logs, leave the old backend active, and report the plugin operation as failed.

## Traffic handover

Once the candidate backend is ready, notify the component that owns client routing that new traffic should be redirected to the candidate port. Depending on the deployment architecture at implementation time, that component may be the Forecastbox launcher, gateway, a local reverse proxy, or an external supervisor.

The routing switch should be atomic from the perspective of new requests and should carry the generation ID for observability. Do not make clients discover a transient candidate port themselves.

After the switch:

1. verify that routed status and a small set of safe smoke requests reach the candidate;
2. stop the old backend from accepting new work;
3. allow or coordinate draining of old requests and connections according to the eventual concurrency design;
4. shut down the old backend cleanly;
5. retain its environment and generation metadata for rollback for a bounded period;
6. mark the candidate generation active only according to a crash-safe activation protocol.

The old and new backends may overlap briefly to avoid downtime, but they must not both independently perform singleton stateful effects. The eventual design needs explicit active/passive roles or fencing; a health check alone does not solve this.

## Rollback

Keep the previously active generation immutable until the new generation has passed post-switch observation. Rollback should switch routing back to that known generation and restart it if it has already stopped.

Persist enough transition state that a supervising process can recover after a crash and determine:

- which generation was last known active;
- which generation routing currently targets;
- whether a candidate is safe to discard;
- whether two backend processes might still be alive;
- whether manual intervention is required.

A plugin database/configuration change may not always be backward compatible with the previous backend generation. The final architecture must define when desired plugin state becomes committed and how state migrations interact with rollback. Avoid destructive migration during candidate validation where possible.

## Concurrency and operation serialization

Multiple plugin routes can be invoked while a candidate is resolving or warming up. The eventual coordinator should expose one serialized desired-state transition or a revisioned reconciliation queue, rather than allowing multiple builders to race for activation.

Reasonable high-level choices include:

- reject new mutations with a busy/conflict response;
- queue them and build successive generations;
- coalesce pending changes into a new desired-state revision and cancel an obsolete candidate before activation.

Whichever policy is chosen, use revision IDs and compare-and-swap semantics so an older candidate cannot become active after a newer request has superseded it.

The current plugin manager lock is not sufficient for a multi-process generation handover. Coordination must survive process boundaries and coordinator restarts.

## Suggested architectural components

Names and placements should follow the codebase at implementation time, but keep these responsibilities distinct:

- **Desired plugin state repository**: durable, revisioned plugin roots and target versions.
- **Environment resolver**: turns base lock plus desired plugin state into candidate input and lock.
- **Generation store**: owns generation directories, metadata, retention, and cleanup.
- **Candidate validator**: runs package, import, and plugin-object checks with the candidate interpreter.
- **Backend process supervisor**: starts candidate backends on reserved ports and captures logs/exits.
- **Readiness evaluator**: applies the generation-aware status contract.
- **Traffic switcher**: redirects new traffic atomically.
- **Transition coordinator**: serializes revisions, fences processes, activates, drains, and rolls back.

Do not place all of these concerns in `domain/plugin/manager.py`. Package resolution can remain related to the plugin domain, while process lifecycle and traffic switching are broader application/deployment concerns.

## Migration from immediate hardening

Until candidate generations are production-ready, retain the immediate constraints-based installer. Introduce the candidate path behind an explicit feature flag or deployment capability check.

A staged rollout could be:

1. Build and validate candidate locks and venvs in shadow mode while the existing installer remains authoritative.
2. Start candidate backends and health-check them without switching traffic.
3. Enable handover in controlled single-user deployments.
4. Add rollback drills and crash-recovery tests.
5. Make candidate generations the default.
6. Remove in-place installation and plugin reload only after all supported deployment modes have a supervisor/traffic-switch mechanism.

Do not let fallback silently mutate the active venv after a candidate resolution failure. Once candidate mode is selected for an operation, failure should leave the old generation active.

## Validation strategy

The eventual implementation should include:

- resolver tests for multiple compatible and incompatible plugins;
- proof that removing a plugin removes its now-unused transitive dependencies from the next exact environment;
- tests that base-lock packages cannot move under the immutable-base policy;
- local wheel/index tests without public PyPI dependence;
- generation build interruption and cleanup tests;
- plugin import/object validation failure tests;
- candidate backend startup and status timeout tests;
- routing switch and rollback tests;
- stale candidate revision tests;
- coordinator crash tests at each activation boundary;
- load tests involving in-flight HTTP requests and long-lived clients once handover semantics are designed;
- tests proving only one generation performs scheduler and other singleton side effects.

Use real subprocesses and temporary venvs for the package and handover integration tests. Unit mocks alone cannot demonstrate interpreter or environment isolation.

## Open decisions for the implementation project

Resolve these explicitly before coding the final activation path:

1. Is the released Forecastbox lock immutable during plugin resolution?
2. Which process owns environment generations and survives backend replacement?
3. Which component performs the traffic switch in each supported deployment mode?
4. What exact status constitutes candidate readiness?
5. How are scheduler, gateway, artifact operations, websocket clients, and other stateful work fenced or transferred?
6. When is desired plugin state committed relative to candidate build and traffic activation?
7. How long are old generations retained, and what disk quota applies?
8. How are credentials and private index settings made available without writing secrets into persisted locks or logs?
9. Are source distributions allowed, and under what build isolation/security policy?
10. What is the rollback policy when the new generation has already performed irreversible state changes?

The package side should be designed so these operational decisions do not require changing lock generation or candidate environment immutability.

## Success criteria

The architecture is successful when:

- the active backend's venv is never modified by a plugin operation;
- all desired plugins are resolved together into one reproducible candidate lock;
- unused plugin-only dependencies disappear naturally from a rebuilt exact environment;
- package and plugin-object validation runs under the candidate interpreter;
- a full candidate backend starts on a separate port and satisfies a generation-aware readiness check before receiving traffic;
- failed candidates leave the old backend and routing untouched;
- traffic can switch with no ordinary request downtime;
- the previous generation remains available for bounded rollback;
- activation is serialized and crash-recoverable;
- concurrency and stateful side effects have an explicit, tested handover design before production rollout.

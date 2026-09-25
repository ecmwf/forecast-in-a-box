# Phase 1 -- Generalising the Lens Model

Prerequisites: `lensExtension-phase1-outputContract-spec.md` and
`lensExtension-phase1-tokens-spec.md`.

Read `lensExtension-overview.md` first.

## Problem

The lens domain
(`backend/src/forecastbox/domain/lens/manager.py`,
`backend/src/forecastbox/routes/lens.py`) is shaped around a single assumption: a lens is
an external process bound to a dynamically claimed port. Every part of the model
reflects it -- an instance holds a `Popen`, status is derived from process liveness, a
port set is an invariant, teardown means killing a process and releasing a port, and
status computation branches on the lens name with an `assert_never` fallthrough.

Two consequences:

- A lens that the backend serves *itself* -- no process, no port -- does not fit, and
  phase 2 introduces exactly that.
- The one existing lens is started with a caller-supplied absolute filesystem path
  (`start/skinnyWMS?local_path=...`), which is both unvalidated against the output it is
  supposed to be showing, and impossible to authorize meaningfully.

## Intent

Widen the model to the definition in the overview -- a lens is an API for external
integration with a run output -- while keeping the difference between the two kinds as
invisible as possible to callers.

**Two lens kinds.** Introduce an explicit discriminator between *process* lenses (a
launched subprocess reached through the reverse proxy) and *native* lenses (the backend
speaks the protocol itself). The parts of the instance model that are process-specific
should be recognisable as such rather than being assumed universal. Status and teardown
become kind-dependent: for a native lens, "running" is a statement about credential
validity, and "stop" means the credential stops working.

Callers should not have to care which kind they are dealing with. Starting, listing,
describing and stopping stay uniform, and the credential model is identical for both.

**Output scoping.** Lenses are started against an output, identified the way the rest of
the API identifies outputs, with run-attempt identity pinned -- `RunLookup` in
`backend/src/forecastbox/routes/run.py` already models this. The backend resolves the
output to whatever the lens needs. Callers no longer supply filesystem paths.

This changes the security posture qualitatively. The path is *derived*, never accepted,
and access to it is gated by the access check that already governs the run
(`RunAccessDenied` in the run domain). Deriving the path also requires deciding
what containment guarantees apply -- resolving symlinks, confirming the result lies
within an expected area of the filesystem, rejecting anything that is not a regular file
or directory. Phase 2 leans on these guarantees heavily, so establishing them here, for
skinnyWMS, is deliberate: the resolution logic is shared.

**Applicability validation.** Before starting, a lens validates that the output's
declared type is one it can serve, using the `fiab-core` helpers from the output
contract task. Asking for a WMS view of a text output should fail cleanly at start.

**Capability metadata in discovery.** `/lens/supported` currently returns a name, a start
route, and a parameter description. It should grow enough metadata for a client to
decide what a lens offers and how to reach it -- which output types it applies to, what
transport it speaks, which credential positions it accepts, whether it is proxied. The
frontend needs this to render tool-specific instructions; phase 2 adds a lens whose
answers differ from skinnyWMS's in every one of those dimensions.

**Token adoption.** skinnyWMS lens access moves onto short-lived tokens. The existing
broad session-based authorization stays in place alongside it for now -- this task does
not remove it -- but the token path must be genuinely exercised rather than merely
present, which is why `lensExtension-phase1-frontend-spec.md` switches the frontend onto
it in the same phase.

## Scope

- Lens kind discriminator, and the status/teardown semantics that follow from it.
- Output-id-based lens start, replacing caller-supplied paths; output-to-path resolution
  with its containment guarantees; applicability validation.
- Capability metadata on lens discovery.
- skinnyWMS migrated to all of the above, including token issuance on start.

Out of scope: adding the native lens itself (phase 2), removing session-based access to
lenses, and any performance consideration.

## Relevant code

- `backend/src/forecastbox/domain/lens/manager.py` -- instance model, status derivation,
  lifecycle, port management.
- `backend/src/forecastbox/domain/lens/proxy.py` -- the proxy contract docstring; note
  that `_resolve_port` currently treats "exactly one port" as an invariant of all lenses.
- `backend/src/forecastbox/routes/lens.py` -- start, status, stop, list, supported,
  proxy.
- `backend/src/forecastbox/routes/run.py` -- `RunLookup`, output content retrieval, the
  existing run access checks.
- `backend/src/forecastbox/domain/run/` -- run records, output characteristics, access
  control.

## A note on route conventions

The routes package documents a convention of avoiding path parameters. The proxy route
already departs from it out of necessity, since it must carry an arbitrary upstream path,
and phase 2 will depart from it for the same reason -- a hierarchical file protocol *is*
addressed by URL path. Record this as a deliberate, reasoned exception where the
convention is stated, so that it does not read as an oversight.

## Contracts to leave behind

- The lens-kind contract: what a lens is, what the two kinds are, what is common and
  what differs, and what a client may assume regardless of kind.
- The output-to-path resolution contract: what is derived from what, and precisely which
  containment guarantees are made. Phase 2 depends on these being stated, not inferred.
- Updates to the proxy docstring: it currently asserts a single-port invariant and
  describes authorization as "any authenticated caller", both of which change here.

## What later phases expect from this task

Phase 2 adds a native lens and expects the model to already accommodate one: no port, no
process, token-derived lifetime, capability metadata that can describe a non-proxied
transport, and a shared, trustworthy output-to-path resolution with stated containment
guarantees.

# Lens Extension -- Overview and Phasing

## Purpose of this document

This is the umbrella document for a multi-phase effort that generalises the Lens concept
and adds a new lens type for retrieving run outputs from outside the browser. It defines
the shared vocabulary, the cross-cutting decisions, and the sequencing. Every
`lensExtension-phase*-spec.md` in this folder assumes the reader has read this document
first, and states its own prerequisites in terms of the phases defined here.

It is deliberately architectural. Individual specs describe intent, boundaries and
prerequisites; they do not prescribe class layouts, method signatures or test
interfaces. The engineer implementing a task is expected to research the codebase
thoroughly for that task, and is explicitly not expected to research the other tasks.

## The problem being solved

The backend frequently runs on a different host than the user. A run produces outputs;
some of those outputs are not values but *local paths* on the backend host -- a directory
of GRIB files, for instance. Today the user can:

- view such an output through the skinnyWMS lens, which renders it in the browser, or
- "download" the output, which returns the path string rather than the data.

What is missing is a way to **explore and retrieve the actual bytes** from outside the
browser: from a shell, from a Python script, from a sync tool, from automation. Copying
whole output trees is wasteful and often not what the user wants -- they may need one
file, or a subtree, or to browse first and decide afterwards.

The answer taken here is to serve output trees over **WebDAV plus plain HTTP**, directly
from the backend, so that ordinary third-party tools (`curl`, `rclone`, `earthkit.data`,
eventually filesystem mounts) work against it without bespoke client code.

## The generalised Lens concept

The Lens abstraction is widened:

> A **Lens** is an API for external integration with a run output. It is presumably
> time-scoped and presumably output-scoped.

Concretely, two kinds exist after this effort:

- **process lenses** -- the backend launches an external process (skinnyWMS today),
  claims a port for it, and reverse-proxies HTTP to it. Time scoping is a property of
  the process lifecycle.
- **native lenses** -- the backend speaks the protocol itself; there is no process and
  no port. Time scoping is a property of the access token alone.

The distinction should be as invisible as possible from the outside: both kinds are
started, listed, described and stopped through the same `/lens/*` routes, and both are
accessed with the same kind of credential. Only where the difference is unavoidable
(status derivation, teardown semantics, capability advertisement) does it surface.

Relevant code: `backend/src/forecastbox/domain/lens/` and
`backend/src/forecastbox/routes/lens.py`.

## Cross-cutting decisions

These hold across all phases; specs may refine them but must not contradict them.

**Access credentials.** Three ways to authenticate against a lens will eventually exist:

1. the caller's ordinary session (JWT cookie) -- the frontend's path;
2. a **short-lived lens token** -- minted on lens start, scoped to exactly one
   `(lens type, output)` pair, and to nothing else. A token for skinnyWMS on output A is
   not valid for WebDAV on output A, nor for skinnyWMS on output B, nor for any other
   API. This is the credential a user pastes into an external tool;
3. a **personal access token (PAT)** -- universal, long-lived, user-scoped, managed
   explicitly. Deferred to phase 4, and needed for use cases that cannot tolerate a
   short lifetime (notably filesystem mounts).

The short-lived token must be usable in three positions -- `Authorization: Bearer`
header, HTTP Basic password, and query parameter -- because different third-party tools
support different subsets. Presence of short-lived tokens in access logs is accepted.

**Output scoping.** A lens is bound to a single output of a single run attempt. Thirty
outputs require thirty lenses and thirty tokens, mirroring how thirty skinnyWMS
instances are required today. Uniform access across many outputs is what PATs are for.
Run-attempt identity must be pinned, so that restarting a run does not silently
re-point an outstanding credential; the existing `RunLookup` helper in
`backend/src/forecastbox/routes/run.py` already encodes attempt semantics correctly.

**Output typing.** Whether a given output can back a given lens is decided from the
output's declared mime type, via helpers owned by `fiab-core`. Lenses validate this
before starting. Callers never supply filesystem paths.

**Contracts live in docstrings.** These spec documents are deleted once implemented
(see `README.md` in this folder). Anything that must survive -- the token contract, the
lens-kind contract, the WebDAV service contract -- belongs in a module docstring, in the
style already established by `backend/src/forecastbox/domain/lens/proxy.py`. Each spec
names which docstrings it is responsible for leaving behind, and the implementer is
expected to transcribe the relevant contract text into them.

## Phases

**Phase 1 -- preparation.** No new user-visible feature. A sequence of independent
hardening and clarification tasks, each its own PR:

- `lensExtension-phase1-configVisibility-spec.md` -- make security-relevant
  configuration discoverable for operators.
- `lensExtension-phase1-outputContract-spec.md` -- give `fiab-core` explicit helpers for
  interrogating output mime types, replacing implicit coupling.
- `lensExtension-phase1-tokens-spec.md` -- short-lived, lens-and-output-scoped tokens.
- `lensExtension-phase1-lensModel-spec.md` -- generalise the lens model to two kinds,
  move skinnyWMS from arbitrary paths to output ids and onto tokens, add capability
  metadata to lens discovery.
- `lensExtension-phase1-frontend-spec.md` -- frontend adopts the token path and gains
  the affordance for handing credentials to external tools.

**Phase 2 -- the WebDAV lens.** `lensExtension-phase2-webdavLens-spec.md`. A native lens
serving one output tree, read-only, over WebDAV and plain HTTP. Delivered as an ordered
sequence of sub-phases, each targeting one client. Performance is explicitly out of
scope. Filesystem mounts are explicitly deferred to phase 4.

**Phase 3 -- performance.** `lensExtension-phase3-rustProxy-spec.md` (and the companion
`lensExtension-phase3-proxyProtocols-spec.md`, which catalogues transport extensions
beyond plain HTTP). Moves the byte-shovelling data plane out of the single Python
worker. Policy -- authorization, path resolution, directory listings -- stays in Python.

**Phase 4 -- personal access tokens.** `lensExtension-phase4-pat-spec.md`. Universal
long-lived credentials, and the client scenarios that depend on them.

Phases are ordered by dependency, but only phase 1 is a hard prerequisite for the
others. Phase 3 and phase 4 are independent of each other.

## What is deliberately not being done

Recorded so that these questions are not re-litigated without new information:

- **FTP and rsync.** Both address resources by port, not by URL path, so neither can be
  multiplexed behind a single backend port the way the lens proxy requires; FTP
  additionally negotiates a second connection per transfer. Both would need a bespoke
  tunnelling client, which defeats the goal of working with tools users already have.
- **An S3-compatible interface.** Attractive for tooling reach, but SigV4 signs the
  `Host` header, which the lens proxy rewrites.
- **WebDAV as a proxied external process.** Serving it natively avoids a subprocess, a
  port, a proxy hop, URL-prefix rewriting, and a second authorization model, and it
  makes correct `Range`/`ETag`/`Content-Length` handling free. If the native approach
  fails, the replacement should be designed afresh in the light of *why* it failed
  rather than resurrected from here.

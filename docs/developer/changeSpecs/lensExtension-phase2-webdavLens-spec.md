# Phase 2 -- The WebDAV Lens

Prerequisites: all of phase 1. In particular this task assumes that lenses can be native
(no process, no port), that they are started against an output with the path derived and
containment-checked by the backend, that short-lived scoped tokens exist and can be
presented in header, Basic-password and query positions, and that the frontend has a
place to put tool-specific instructions.

Read `lensExtension-overview.md` first.

## Problem

A run produces an output that is a directory tree of files on the backend host. The user
is elsewhere. They want to look at what is there, then take some of it -- one file, a
subtree, or eventually all of it -- using tools they already have.

Neither existing mechanism serves this. Downloading the output returns the path string,
not the data. Adding a whole-tree download endpoint would be all-or-nothing, and a
frontend file browser would not help the automation, scripting and third-party-tool cases
that motivate this at all.

## Intent

Add a **native lens that serves one output tree read-only over WebDAV and plain HTTP**,
so that ordinary third-party tools work against it with no bespoke client code.

WebDAV is chosen because it is HTTP: it carries the full resource path in every request,
so it needs no new transport, no additional port, and no protocol-specific
infrastructure. It supports ranged and resumable reads, and it has a wide base of
existing clients. The plain-HTTP subset of the same endpoint -- fetching a single file by
URL, and listing a directory in a form a machine or a browser can consume -- covers
clients that do not speak WebDAV at all, and is strictly simpler.

Serving it natively, rather than by launching and proxying a file server process, avoids
a subprocess, a port, a proxy hop, URL-prefix rewriting and a second authorization model,
and it lets response metadata that matters for large transfers -- content length, entity
tags, range handling -- be produced correctly by the web framework rather than
reconstructed through a proxy.

## Non-negotiable properties

- **Read-only.** No writes, no uploads, no deletes, no moves. This removes most of the
  protocol surface and all of its risk.
- **Confined to one output.** A lens instance exposes exactly the tree derived from its
  output, and no request may escape it. Path containment is established in phase 1 and
  must be enforced on every request, not only at start.
- **Authorized on every request.** Access is granted by the lens's short-lived token, or
  by the caller's own session; in either case it is checked per request, and it inherits
  the access control that already governs the run.
- **Correct for large files.** Ranged requests, resumption, and accurate size and
  modification metadata are what make the difference between a tool that shows progress
  and can resume, and a tool that downloads blind.

## Explicitly out of scope

- **Performance.** Every byte crossing the single backend worker is a known and accepted
  limitation here. Phase 3 addresses it; this phase must not contort its design in
  anticipation, beyond avoiding choices that would obstruct later offloading of file
  bodies.
- **Filesystem mounts** (`davfs2`, Finder, Windows Explorer). These persist a mount and
  re-authenticate from a stored secret, which is structurally incompatible with a
  short-lived token; they also need the credential as a Basic password and are sensitive
  to transport security and protocol-compliance details. They are deferred to phase 4,
  where universal credentials exist. Design decisions in this phase should not make them
  harder than necessary, but they are not a target here.
- **Writes**, in any form, in any later phase, unless separately justified.

## Delivery: ordered sub-phases

Each sub-phase is a separate increment, targeting one client, ordered by ascending risk
and complexity. There is no requirement that they land close together in time. Each adds
its own tests (below) and, where user-facing, its own entry in the credential hand-off
affordance introduced in phase 1.

1. **Proof of concept, exercised with `curl`.** Fetch a single file, and list a
   directory in a machine-readable form. Token accepted in header and query positions.
   No WebDAV verbs yet. This establishes routing, resolution, containment, authorization
   and streaming; everything afterwards is protocol surface on a working core.

2. **Plain-URL consumers, exercised with `earthkit.data`.** A single file addressable by
   a self-contained URL, including its credential, that scientific Python tooling can
   open directly. Close to free after sub-phase 1, but it is the sub-phase that makes
   ranged and conditional request handling non-negotiable, since such clients read
   remote files piecewise rather than downloading them.

3. **Browsable listings.** A human-readable directory listing, which also happens to be
   consumable by recursive fetchers. Low risk, and it gives the frontend and casual
   users something immediately useful.

4. **Frontend integration.** The frontend consumes the machine-readable listing and
   presents the WebDAV lens alongside the others, with tool-specific instructions in the
   hand-off affordance. The point is the hand-off, not building a file manager.

5. **`rclone`.** This is where actual WebDAV begins: capability advertisement, and
   directory property queries returning per-entry type, size, modification time and
   entity tag. `rclone` is the reference third-party client -- it browses, copies, syncs,
   and can present the tree interactively -- and getting it working is the single largest
   step in the value delivered by this phase.

Mounts follow in phase 4 and are not part of this sequence.

## Testing

Testing is not an afterthought here: the entire value of this phase is "tool X works
against it", and without executable evidence each sub-phase will silently regress the
previous ones. Every sub-phase must extend the test suites, with real invocations of the
real client where that is possible -- `curl` and `rclone` are ordinary executables and can
be driven from a test; `earthkit.data` can be exercised in-process.

The repository has unit, integration, large-E2E and adhoc suites, and the choice among
them is an implementation matter. In general a combination of integration and large-E2E
tests is the natural fit. For clients that cannot be automated -- the mount clients in
phase 4 -- the equivalent obligation is a setup helper in the adhoc suite plus written
manual steps.

## Relevant code

- `backend/src/forecastbox/routes/lens.py` and `backend/src/forecastbox/domain/lens/` --
  where the lens lives, and the model that phase 1 generalised.
- `backend/src/forecastbox/routes/run.py`, `backend/src/forecastbox/domain/run/` --
  output identity, run access control.
- `backend/packages/fiab-core/src/fiab_core/fable.py` -- output type predicates, for
  deciding which outputs this lens applies to.
- `backend/development.md` for backend conventions and the test suites.

## Route conventions

A hierarchical file protocol is addressed by URL path; path parameters are unavoidable.
Phase 1 records this as a reasoned exception to the routes package's convention, and this
phase relies on that record.

## Contracts to leave behind

A module docstring owning the service contract, in the style of
`backend/src/forecastbox/domain/lens/proxy.py`, which is the established model for
"authoritative contract between backend, clients and protocol". It should state what is
served, what is not, what confinement and authorization guarantees hold, which parts of
the protocol are implemented and which are deliberately absent, and which credential
positions are accepted.

It should also carry a brief record of rejected alternatives -- no more than a sentence
each -- covering FTP and rsync, an S3-compatible interface, and running a file-server
process behind the lens proxy. The purpose is to stop the questions being re-litigated
without new information; the reasoning is in `lensExtension-overview.md` and does not
need repeating at length.

## What later phases expect from this task

- Phase 3 offloads the streaming of file bodies out of the Python worker while leaving
  authorization, path resolution and directory listings in place. It expects the split
  between "decide and describe" and "move bytes" to be a clean seam.
- Phase 4 adds universal credentials and, on top of them, the mount clients. It expects
  the protocol surface to be already correct, so that the remaining work is credential
  lifetime and client-specific compliance details rather than new protocol.

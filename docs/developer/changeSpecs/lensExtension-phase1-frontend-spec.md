# Phase 1 -- Frontend Adoption of Lens Tokens

Prerequisites: `lensExtension-phase1-tokens-spec.md` and
`lensExtension-phase1-lensModel-spec.md`.

Read `lensExtension-overview.md` first.

## Problem

The frontend starts lenses and consumes them -- the WMS viewer addresses skinnyWMS
through the lens proxy prefix and rebases the URLs the lens emits (see
`frontend/src/features/viewer/wms-capabilities.ts` and
`frontend/src/api/hooks/useLens.ts`). It authenticates implicitly, by virtue of the
session cookie riding along on same-origin requests.

Two things change in phase 1. Lenses are started against outputs rather than paths, and
a short-lived, narrowly scoped token is issued on start. The frontend must follow both.

There is also a gap the frontend is uniquely placed to close. The session cookie is
`HttpOnly`, so the frontend cannot show a user a working credential today. With tokens
it can -- and handing the user a ready-made command for their own tooling is the entire
point of the effort.

## Intent

**Adopt the token path in earnest.** The frontend should authenticate lens access with
the issued token rather than relying on the ambient session, even though session-based
access still works. Two reasons: it keeps the token path exercised rather than
theoretical, and it is the configuration phase 2 assumes. Note that browser-originated
subresource requests -- tile images and similar -- cannot carry custom headers, so the
query-parameter position will be the practical one for those.

**Follow the model changes.** Lens start now takes an output rather than a path;
discovery now returns capability metadata rather than a fixed parameter description. The
frontend should offer a lens for an output on the basis of that metadata and the
output's declared type, rather than on hardcoded knowledge of what skinnyWMS wants.

**Introduce the hand-off affordance.** Where the user can already open a lens, they
should also be able to obtain what they need to use it from outside the browser: the
address, the credential, and its expiry, presented as something directly usable rather
than as raw values to assemble. The existing skinnyWMS affordance -- showing the exact
string to paste into an external WMS consumer -- is the model to generalise.

Design considerations for that affordance:

- Different tools need the credential in different positions and different syntaxes;
  what is offered should be driven by the lens's advertised capabilities rather than
  hardcoded per lens.
- Expiry must be visible. A user who pastes a command and returns to it tomorrow needs
  to understand why it stopped working.
- In passthrough deployments there is no credential; the instructions should degrade to
  the credential-free form rather than presenting an empty or meaningless token.
- `frontend/src/lib/clipboard.ts` already handles the Safari-safe copy path.

Phase 2 extends this affordance with substantially more tool-specific content. This task
should establish it as a place that new lenses and new tools plug into, not as a
skinnyWMS-specific dialog.

## Scope

- Lens start and access migrated to output ids and tokens.
- Lens offering driven by capability metadata and output type.
- The credential hand-off affordance, generalised beyond skinnyWMS.

Out of scope: a file browser UI, and anything WebDAV-specific -- phase 2 covers both.
More frontend surface is not the goal of this effort; the goal is connecting users to
their own tools.

## Relevant code

- `frontend/src/api/hooks/useLens.ts` -- lens lifecycle from the client side.
- `frontend/src/features/viewer/wms-capabilities.ts` -- proxy-prefix rebasing.
- `frontend/src/features/executions/outputs/` -- output adapters and the registry that
  decides what an output offers.
- `frontend/src/lib/clipboard.ts`.
- `frontend/GUIDELINES.md` for frontend conventions.

## What later phases expect from this task

Phase 2 adds a lens whose value is almost entirely in external tooling. It expects the
hand-off affordance to exist and to be extensible per lens and per tool, so that adding
a new client to the supported set is an increment rather than a new feature.

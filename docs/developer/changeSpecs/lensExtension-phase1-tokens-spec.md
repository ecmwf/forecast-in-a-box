# Phase 1 -- Short-Lived Lens Tokens

Prerequisites: `lensExtension-phase1-configVisibility-spec.md` is expected but not
strictly blocking -- this task introduces configuration that should be marked
security-relevant, and can adopt the marking mechanism once it exists.

Read `lensExtension-overview.md` first.

## Problem

Two problems, one mechanism.

**Authorization is too coarse.** `backend/src/forecastbox/routes/lens.py` carries an
explicit TODO: the lens proxy route requires *an* authenticated caller, but any
authenticated caller may reach any lens. There is no notion of a credential that grants
access to one lens and nothing else. The proxy module docstring
(`backend/src/forecastbox/domain/lens/proxy.py`) states this limitation as part of its
contract.

**The session credential cannot leave the browser.** The session JWT is delivered in an
`HttpOnly` cookie (`CookieTransport` with default settings, in
`backend/src/forecastbox/domain/auth/users.py`). The frontend's own JavaScript therefore
cannot read it, which means the frontend cannot offer a "here is the exact command to
paste into your terminal" affordance -- there is nothing it can put on the clipboard. The
only way a user gets a usable credential into an external tool today is to extract the
cookie by hand from browser developer tools, which is what `cli/`'s `FIAB_AUTH_TOKEN`
handling expects (see `cli/crates/fiab-lib-client/src/client.rs`).

Both are solved by minting a narrow credential server-side and returning it in a
response body.

## Intent

Introduce a **short-lived lens token**: a credential that authorizes access to exactly
one lens on exactly one output, for a bounded time, and to nothing else.

Required properties:

- **Scope is `(lens type, output, run attempt)`.** A token for skinnyWMS on output A does
  not work for WebDAV on output A, nor for skinnyWMS on output B. It is not a
  general-purpose per-user lens credential. Run attempt must be pinned so that
  restarting a run cannot silently re-point an outstanding token; `RunLookup` in
  `backend/src/forecastbox/routes/run.py` already models attempt identity.
- **Not interchangeable with any other credential.** The token must be rejected
  everywhere outside the lens routes it was scoped to, and conversely a session JWT must
  not be usable in the token's place where a token is expected. Since the natural
  implementation signs with the existing JWT secret, a type or audience discriminator is
  mandatory, not optional -- without it a narrow read-only credential silently becomes a
  full session credential.
- **Presentable in three positions.** `Authorization: Bearer`, HTTP Basic password, and
  query parameter. Different third-party tools support different subsets; phase 2
  depends on all three eventually being available. Not every position needs to be
  *accepted* by every route from day one, but the token format must not preclude any of
  them. Appearance of short-lived tokens in access logs is accepted.
- **Bounded lifetime, configurable.** A TTL setting governs issuance. A TTL of zero
  disables token *issuance* entirely -- and therefore lens creation in the sense of
  minting a credential -- while leaving lenses reachable by ordinary session
  authentication (and, later, by PATs, which are separately disableable).
- **Revocation is thought through, not necessarily implemented.** A stateless signed
  token cannot be revoked before expiry. Whether that is acceptable at the chosen TTL,
  and what a "revoke everything" lever would look like, should be reasoned about and
  recorded even if the answer is "short TTL is sufficient for now".

Explicitly *not* required: persistence, listing, naming, or per-token management UI.
Those are PAT concerns and belong to phase 4.

## Scope

- Token minting, tied to lens start, returned to the caller.
- Token validation as an authorization mechanism on lens access routes, alongside -- not
  yet replacing -- the existing session-based check. The broad session path stays for
  now so the frontend keeps working during migration; whether to narrow it later is a
  separate decision.
- Configuration for TTL, marked security-relevant.
- Ensuring the token cannot be used outside its scope, and that other credentials cannot
  be used in its place.

Out of scope: PATs; retiring the session path for lens access; the `cli/` credential
handling, which continues to work as it does today.

## Relevant code

- `backend/src/forecastbox/domain/auth/users.py` -- JWT strategy, secret, cookie
  transport, `get_auth_context`.
- `backend/src/forecastbox/utility/auth.py` -- `AuthContext`, passthrough semantics.
- `backend/src/forecastbox/routes/lens.py` -- the routes to be protected, and the TODO
  this task addresses.
- `backend/src/forecastbox/domain/lens/proxy.py` -- its docstring states the current
  authorization limitation and must be updated.
- `backend/src/forecastbox/utility/config.py` -- new settings.

## Passthrough mode

`config.auth.passthrough` is the default in single-user deployments and disables
authentication entirely. Decide and document what token issuance means there. The
guiding principle is that external-tool instructions shown to a user in passthrough mode
should simply omit credentials rather than carry meaningless ones.

## Contracts to leave behind

A module docstring owning the token contract, in the style of
`backend/src/forecastbox/domain/lens/proxy.py`: what the token is, what it authorizes,
what it deliberately does not authorize, in which positions it may be presented, how
scope is expressed, what the lifetime rules are, and why type separation from the
session credential is load-bearing. Take the "Intent" section above as the basis and
transcribe it there.

The proxy docstring's authorization section must be updated in the same change.

## What later phases expect from this task

- `lensExtension-phase1-lensModel-spec.md` issues these tokens on lens start for both
  lens kinds.
- `lensExtension-phase1-frontend-spec.md` builds the paste-a-command affordance on top
  of them.
- Phase 2 relies on them as the sole external credential for the WebDAV lens.
- Phase 4 introduces PATs as a parallel, universal credential, and expects the
  distinction between the two to be already clear in the code.

# Phase 4 -- Personal Access Tokens

Prerequisites: phase 1 and phase 2. Independent of phase 3.

Read `lensExtension-overview.md` first.

## Problem

After phase 2 the only credential a user can take outside the browser is the short-lived
lens token: bounded in time, and scoped to a single lens on a single output. That is
deliberately narrow, and it is the right default. It is also insufficient for three
recurring cases.

**Persistent mounts.** `davfs2`, macOS Finder and Windows Explorer persist a mount and
re-authenticate from a stored secret. A credential that expires within hours means the
mount breaks daily, which does not count as working. These clients also require the
credential as an HTTP Basic password, and are sensitive to transport security and to
protocol-compliance details that a scripted client tolerates.

**Uniform access across many outputs.** A lens token is bound to one output by design --
thirty outputs mean thirty tokens. That is correct for interactive use and wrong for a
post-processing script that walks a whole run.

**Automation.** A scheduled job cannot be re-primed with a fresh short-lived token every
time it runs, and it should not be carrying a user's session cookie either. The `cli/`
tool currently expects exactly that: `FIAB_AUTH_TOKEN` is the user's session JWT,
extracted by hand from the browser and replayed as a cookie (see
`cli/crates/fiab-lib-client/src/client.rs`). That is the workaround this phase retires.

## Intent

Introduce a **personal access token**: a user-scoped, long-lived, explicitly managed
credential, standing alongside -- not replacing -- the short-lived lens token.

The two are complementary and the distinction should stay legible in the code and to
users:

| | short-lived lens token | personal access token |
|---|---|---|
| scope | one lens, one output, one attempt | the user's own identity |
| lifetime | minutes to hours | long, capped, explicit |
| issued by | starting a lens | deliberate user action |
| managed | not at all; it expires | named, listed, revocable |
| stored at rest | nowhere | hashed |
| intended for | pasting into a tool right now | mounts, automation, the CLI |

Required properties:

- **Explicitly created, named, listed and revocable.** A user must be able to see what
  they have issued and withdraw it. Unlike the short-lived token, revocation here is a
  requirement, not a discussion.
- **Never recoverable after creation.** Shown once, stored hashed.
- **Capped lifetime.** `verify_entitlements` in
  `backend/src/forecastbox/domain/auth/users.py` runs at login, so a credential that
  outlives a session also outlives entitlement changes at the identity provider. A
  maximum lifetime bounds that exposure; whether anything more is warranted should be
  reasoned about and recorded.
- **Presentable as a Basic password**, since that is what the mount clients require, in
  addition to the bearer position that scripted clients prefer.
- **Separately disableable.** An operator must be able to turn PATs off independently of
  short-lived tokens, with the setting marked security-relevant per
  `lensExtension-phase1-configVisibility-spec.md`.
- **Not interchangeable with the other credentials.** The same type separation that
  phase 1 established between the session credential and the lens token applies here.

## Scope

- The credential itself: creation, storage, validation, revocation, lifetime cap,
  configuration.
- Management surface for the user, and the accompanying hand-off instructions -- the
  set-up-once forms, including credential files that tools read automatically, rather
  than the paste-this-now forms that suit short-lived tokens.
- **Mount clients**, deferred here from phase 2: `davfs2`, Finder, Windows Explorer,
  against the WebDAV lens. Expect the remaining work to be client-compliance details and
  documentation rather than new protocol. These cannot be tested automatically; the
  obligation is a setup helper in the adhoc suite plus written manual steps, and a
  troubleshooting entry per client -- that page will accumulate real value, since each of
  these clients fails in its own idiosyncratic way.
- **Retiring the `cli/` workaround**: `FIAB_AUTH_TOKEN` stops meaning "your session
  cookie".

Optional, and worth considering only if the copy-paste step proves to be the friction:
a browser-assisted login flow for the CLI, in which the tool opens a browser, the user
authenticates however the deployment requires, and the resulting credential is delivered
back to the tool automatically. It is a delivery mechanism for the same credential, it
helps only our own CLI, and it should not gate anything else in this phase.

## Relevant code

- `backend/src/forecastbox/domain/auth/` and `backend/src/forecastbox/utility/auth.py`.
- `backend/src/forecastbox/schemata/user.py` -- user and OAuth account persistence.
- Wherever phase 1 placed lens token minting and validation.
- `cli/crates/fiab-lib-client/src/client.rs`, `cli/crates/fiab-cli/src/config.rs`.
- `docs/troubleshooting.md`, `docs/userGuide.md`.

## Contracts to leave behind

The credential contract belongs in the module docstring that owns PATs: what a PAT is,
how it differs from the lens token and from the session, where it may be presented, what
its lifetime and revocation rules are, and why type separation between the three
credential kinds is load-bearing.

## Why this comes last

PATs are not difficult to build. They are deferred because they add outward complexity --
another configuration surface, another thing to document, another item in an operator's
security reasoning, another persistent secret to protect -- and because none of it is
needed to deliver the value of phases 1 and 2. Building them last also means they are
designed against real usage of the short-lived token rather than in anticipation of it.

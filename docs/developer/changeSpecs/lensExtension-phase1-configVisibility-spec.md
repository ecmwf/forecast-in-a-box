# Phase 1 -- Operator Visibility of Security-Relevant Configuration

Prerequisites: none. This task is independent of the rest of phase 1 and may be done at
any point; it is grouped here because the lens work adds configuration that an operator
must be able to find.

Read `lensExtension-overview.md` first for context, though this task touches lenses only
incidentally.

## Problem

The backend has a large and growing number of configuration options, concentrated in
`backend/src/forecastbox/utility/config.py` and documented for operators in
`docs/operator/tuningAndConfiguration.md`. A security-conscious operator preparing a
deployment currently has no way to answer "which of these settings affect my security
posture, and what are the safe values?" other than reading everything.

Upcoming work makes this worse rather than better: the lens extension introduces
settings that gate credential issuance and external data access. Those must be
findable, not buried in an alphabetical list.

## Intent

Give configuration options a first-class, machine-readable notion of being
security-relevant, and derive an operator-facing view from it, so that the view cannot
drift from the code.

Desired properties:

- **Declared at the option, not in a separate list.** A maintainer adding a
  security-relevant option should mark it in the same place they define it. A separate
  hand-maintained inventory will rot.
- **Derivable.** The operator-facing documentation section should be generated or
  verified from the declarations rather than written twice.
- **Actionable.** For each such option, an operator needs to know what it controls, what
  the risk of the permissive setting is, and what the hardened setting is. A flag alone
  is not enough; a short rationale per option is.
- **Complete enough to be trusted.** A partially-applied marking is worse than none,
  because it implies the unmarked options are safe. Part of this task is a sweep of the
  existing configuration to classify what already exists.

## Scope

- A mechanism for marking configuration options as security-relevant, with the
  accompanying per-option rationale.
- A sweep of existing options, applying the marking.
- An operator-facing presentation of the result. Whether that is a generated section in
  `docs/operator/tuningAndConfiguration.md`, a separate hardening page, or an endpoint
  or CLI command is left to the implementer; the constraint is that it is derived from
  the declarations and kept honest by a test.
- Guidance for future maintainers, recorded where configuration is defined, so that new
  options get classified as they are added.

Out of scope: changing any default value, or adding new options. This task makes the
existing surface legible; it does not re-tune it.

## Relevant code

- `backend/src/forecastbox/utility/config.py` -- the settings models.
- `docs/operator/tuningAndConfiguration.md` -- current operator-facing configuration
  documentation.
- `install/config.toml` -- shipped example configuration.

## Contracts to leave behind

The convention for marking and rationalising security-relevant options must be
documented alongside the configuration models themselves, so that it is visible to
anyone adding an option.

## What later phases expect from this task

Phase 1's token work and phase 4's PAT work each add options that gate credential
issuance. They expect the marking mechanism to exist so they can use it, and they expect
the operator-facing view to pick them up automatically.

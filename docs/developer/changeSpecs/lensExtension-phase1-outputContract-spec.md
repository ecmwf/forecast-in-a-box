# Phase 1 -- Explicit Output Format Contract in `fiab-core`

Prerequisites: none.

Read `lensExtension-overview.md` first.

## Problem

An output of a run carries a mime type, declared by the plugin that produced it. Some
mime types encode more than a media type: they encode a *contract about what the value
means*. The current example is

```
text/plain; fiab-format=gribdir
```

defined as `GRIB_MIME` in
`backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/blocks.py`, which means "the
value of this output is not data, it is a local filesystem path to a directory of GRIB
files".

That contract is currently implicit and duplicated by string comparison across
component boundaries -- the plugin defines it, the backend acts on it, and the frontend
re-declares the same literal in
`frontend/src/features/executions/outputs/adapters/grib.ts`. There is exactly one
helper in `fiab-core` today (`is_textual` in
`backend/packages/fiab-core/src/fiab_core/fable.py`), and everything else is ad hoc.

This is a latent correctness problem in general, and a blocking one for the lens work
specifically: a lens must be able to validate "can I be applied to this output?" before
starting, and it must be able to do so from the declared type rather than by guessing or
by trusting a caller-supplied path.

## Intent

Make the output format contract explicit and centrally owned by `fiab-core`, which is
the package that exists precisely to define the contract between the backend and its
plugins.

Desired properties:

- **Mime type remains the carrier.** It is already transported end-to-end, it already
  reaches the frontend, and the frontend already uses it to decide what it can offer.
  The representation should not move; only its handling should improve.
- **Named aliases instead of scattered literals.** The known format strings should be
  defined once, in `fiab-core`, and referenced by name by plugins and backend alike.
- **Predicates instead of string comparison.** Alongside the existing `is_textual`,
  callers should be able to ask semantic questions of a mime type -- is this GRIB, is
  the value a filesystem path, and so on. Parameter parsing (`; fiab-format=...`) should
  happen in one place rather than at every call site.
- **Room to grow.** More formats will appear. The mechanism should make adding one a
  local change in `fiab-core` plus its declaration in the producing plugin.

## Scope

- Aliases and predicate helpers in `fiab-core`, covering at minimum the distinction
  "the value is data" versus "the value is a path", plus the GRIB-directory case.
- Migration of existing call sites onto them. `backend/src/forecastbox/domain/run/service.py`
  already imports `is_textual`; `backend/src/forecastbox/routes/run.py` and the lens
  routes are the other likely consumers.
- Consideration of whether and how the frontend should stop re-declaring the literal.
  Sharing the constant across the language boundary may or may not be worth the
  machinery; the decision should be made deliberately and recorded, not left implicit.

Out of scope:

- Validating that a path-typed output actually points at real, well-formed data. The
  backend could conceivably verify that a claimed GRIB directory contains GRIB, but that
  is a separate concern and is not required by any consumer yet.
- Changing the trimming of stored output values. The length cap on
  `RunOutputCharacteristic.value` (see
  `backend/src/forecastbox/domain/run/cascade.py`) is overload protection against a
  misbehaving plugin, not a constraint that legitimate paths are expected to hit.

## Relevant code

- `backend/packages/fiab-core/src/fiab_core/fable.py` -- `is_textual`, the output
  characteristic model.
- `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/blocks.py` -- `GRIB_MIME`.
- `backend/src/forecastbox/domain/run/service.py`, `backend/src/forecastbox/routes/run.py`.
- `frontend/src/features/executions/outputs/adapters/grib.ts` and its tests.

## Contracts to leave behind

`fiab-core` must document, in the module that owns these helpers, what the format
contract is: which parameters are meaningful, what each declared format promises about
the output's value, and the expectation that plugins declare rather than assume. Take
the description above as the basis for that docstring.

## What later phases expect from this task

`lensExtension-phase1-lensModel-spec.md` moves lenses from caller-supplied paths to
output ids. To do that it must ask, of a given output, "is this a path-valued output of
a kind I can serve?" -- and get an authoritative answer. Phase 2's WebDAV lens asks the
same question of the same helpers.

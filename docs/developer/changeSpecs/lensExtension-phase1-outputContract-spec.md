# Phase 1 -- Explicit Output Format Contract in `fiab-core`

Prerequisites: none.

Read `lensExtension-overview.md` first.

## Current state

The output format contract has been made explicit as structured fields on `RawOutput`
in `backend/packages/fiab-core/src/fiab_core/fable.py`, replacing the earlier mime type
parameters (`text/plain; fiab-format=gribdir; fiab-fetchable=1`):

- `mime_type` -- a standard mime type only, without fiab-specific parameters.
- `fetchable` -- the value is a path to a file or directory tree, fetchable as a zip.
  Requires a text/plain mime type.
- `url_dataformat` -- a `UrlDataFormat` enum (`gribdir`, `zarr`) describing the data at
  the path the value represents. Requires a text/plain mime type.
- `skinnywms_issue` -- if set, an explanation why skinnyWMS is known to display the data
  incorrectly, e.g. an ensemble `number` dimension with more than one value. Set by the
  producing plugin from the input Qube during validation.

Plugins declare these fields in `validate`. The backend persists them in
`RunOutputCharacteristic` (`backend/src/forecastbox/domain/run/cascade.py`) and exposes
them in `RunOutputDetail` (`backend/src/forecastbox/routes/run.py`). The frontend
currently recodes `fetchable` and `url_dataformat` into the legacy long mime type at the
schema boundary (`frontend/src/api/types/job.types.ts`), which the output adapters in
`frontend/src/features/executions/outputs/adapters/` still key on.

## Remaining scope

- Lens applicability checks should be decided from the structured fields above rather
  than from the mime type.
- The frontend adapters may move from the recoded long mime onto the structured fields
  directly; the decision should be made deliberately and recorded.
- Adding a new format remains a local change: a new `UrlDataFormat` member in `fiab-core`
  plus its declaration in the producing plugin.

Out of scope:

- Validating that a path-typed output actually points at real, well-formed data.
- Changing the trimming of stored output values. The length cap on
  `RunOutputCharacteristic.value` is overload protection against a misbehaving plugin,
  not a constraint that legitimate paths are expected to hit.

## Contracts to leave behind

The field descriptions on `RawOutput` in `fiab-core` document the format contract: what
each declared field promises about the output's value, and the expectation that plugins
declare rather than assume.

## What later phases expect from this task

`lensExtension-phase1-lensModel-spec.md` moves lenses from caller-supplied paths to
output ids. To do that it must ask, of a given output, "is this a path-valued output of
a kind I can serve?" -- and get an authoritative answer from the structured `RawOutput`
fields. Phase 2's WebDAV lens asks the same question of the same fields.

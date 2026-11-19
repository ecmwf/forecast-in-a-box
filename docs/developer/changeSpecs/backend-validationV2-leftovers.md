# Backend Validation V2 leftovers

This file tracks items from the original validation v2 specs that were intentionally not covered by the staged
implementation (tasks 1 through 8). The task specs themselves, as well as the `backend-validationV2-frontendImpact.md`
companion document, have since been deleted; this file is self-contained.

Last checked against the codebase at commit `a797ab8e`.

## Expand left

The original spec discusses future "expand left" behavior:

- starting from a product block and suggesting source blocks for its inputs
- connecting an existing product and source block
- replacing an existing arrow with a transform block
- changing expand from `expand(input)` to something like `expand(input?, output?)`

Still not implemented. `PUT /blueprint/expand` (`routes/blueprint.py`, `domain/blueprint/service.py::_validate_expand_with_buckets`)
only computes rightward `possible_expansions` per block (with `configuration_restrictions`), plus `possible_sources` for
an empty start.

## Cross-language type compliance suite

The original spec mentions a CSV-style compliance suite for comparing backend and frontend type understanding, with
columns such as:

- literal value
- Python evaluation input
- JavaScript evaluation input

Still not implemented. There are Python unit tests for `FableType.validate_convert` in fiab-core, and the frontend has
its own parser of the type grammar (`frontend/src/components/base/fields/fable-type.ts`), but no shared test vectors.
The need has grown, since the grammar now contains `union[...]` and `none` (see below) which the frontend widget
projection (`value-type-parser.ts`) maps to `unknown`.

## Frontend type validation and completion

The user story includes `client_type_understanding`: frontend-side validation and completion based on `value_type`,
constrained expansion restrictions, and glyph behavior.

Largely implemented on the frontend: it parses Fable type expressions (`fable-type.ts`), projects them onto widgets
(`value-type-parser.ts`: str/int/float/date/datetime/list/enum/enumClosed/geodomain/grid/artifact/param), and consumes
`configuration_restrictions` (`features/fable-builder/...`). Remaining gaps: no widget for `union[...]`/`none` and some
enum subtypes (they fall back to `unknown`), and no shared compliance suite (previous section).

## Blueprint readiness metadata

Validation and blueprint persistence accept incomplete blueprints when the only issue is missing configuration values or
configuration values referencing missing glyphs; the missing values are only rejected at compile time
(`domain/run/compile.py`, "missing configuration options").

Still not implemented: a persistence-level metadata flag recording whether a saved blueprint is ready for compilation
(no missing configuration options and no missing glyphs). The `blueprint` table (`schemata/blueprint.py`) has no such
column; adding one requires a new column, ie it is blocked by the lack of a migration mechanism (see
`backend-db_migrations.md`), or must be computed on read.

## Plugin-wide missing-value resilience

Backend validation omits missing configuration values before plugin validation, but does not require every plugin to
gracefully handle the missing values. If important plugin validators still crash or produce poor warnings for
incomplete blocks, that cleanup should be handled separately, per plugin (eg `backend/packages/fiab-plugin-ecmwf`).

## Richer type system features

The spec explicitly excludes pandera/pydantic-like validations. These remain out of scope:

- numeric ranges
- temporal comparisons
- regex/string constraints
- cross-field validation
- plugin-specific semantic validation inside `FableType`

Such validation should remain plugin-owned.

## None and optional semantics

The original proposal said `None` should not be a normal accepted value and suggested not adding `allow_none`; plugin
declarations using `optional[int]` were exposed as `int`.

The codebase has since moved on: fiab-core has a `none` type (`fiab_core/types/definitions.py::NoneType`, grammar
`"none"`), meant to be used inside a union such as `union[int,none]` to declare that an option accepts an explicit
null, which is distinct from a missing value. The backend propagates explicit nulls (`CompilerRuntimeContext.resolution`
values are `str | None`, glyph remapping skips null values). The grammar has no `optional[...]` wrapper anymore; the
frontend still accepts it as a legacy form.

Remaining: decide whether existing plugin declarations that were flattened from `optional[T]` to `T` should be migrated
to `union[T,none]`, and audit plugins' internal handling of `None` (see the plugin-resilience item above).

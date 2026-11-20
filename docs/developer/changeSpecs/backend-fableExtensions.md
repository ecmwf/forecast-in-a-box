# Extensions of Fable Language and Block Building

## Expand Left and Multi Input

Certain blocks will require supporting multiple inputs, eg validation/anomaly products that need climatology inputs, or some regional models, or models with observations.
Currently, we expand to the right, meaning for a given block, we alllow adding consumers of its output.
To allow multi input per block, as well as unlock other UX features, such as:
- starting from a product block and suggesting source blocks for its inputs,
- connecting an existing product and source block,
- replacing an existing arrow with a transform block,
we need to move from `plugin.expand(input) -> *blocks` to `plugin.expand(*inputs, *outputs) -> *blocks`.
The expansion needs to be partial, as in, "given pre-existing inputs and/or outputs, can a block be put between them so that, with perhaps other blocks fed to it as missing inputs/outputs, it would yield a valid blueprint?".

## Partial Validation and Robustness

Validation and blueprint persistence should accept incomplete blueprints when the only issue is missing configuration values or
configuration values referencing missing glyphs; the missing values are only rejected at compile time.

This partial validity, or validity-but-not-readiness, could either be stored, or better re-computed upon retrieval (as it may change by a change to the global glyphs -- note that existing valid stored blueprints may become invalid, unlike runs which copy the glyph values in the compiler runtime context).

It would require contract changes both between frontend and backend, and between backend and plugins, as well as internal fixes in each:
 - backend needs to recompute upon retrieve (or have frontend re-invoke),
 - frontend needs to display correctly,
 - each plugin (each block!) needs to handle carefully missing values at first, and evaluate maximum

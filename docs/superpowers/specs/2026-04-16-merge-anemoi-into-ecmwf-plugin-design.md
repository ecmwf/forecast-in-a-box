# Design: Merge fiab-plugin-anemoi into fiab-plugin-ecmwf

## Summary

Move all Anemoi functionality from the `fiab-plugin-anemoi` package into `fiab-plugin-ecmwf`, registering the Anemoi blocks as part of the existing `ecmwf-base` plugin. Delete `fiab-plugin-anemoi` entirely.

## Architecture

The Anemoi source files are placed in a `anemoi/` subpackage within `fiab_plugin_ecmwf` to keep them isolated from the existing blocks. The subpackage has no plugin registration of its own -- the main `fiab_plugin_ecmwf/__init__.py` imports and registers all six blocks together.

```
fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/
├── __init__.py          # registers all 6 blocks (ekdSource, ensembleStatistics,
│                        # temporalStatistics, zarrSink, anemoiSource, anemoiTransform)
├── blocks.py            # unchanged
├── metadata.py          # unchanged
├── py.typed             # unchanged
├── _version.py          # unchanged
├── runtime/
│   ├── __init__.py
│   ├── source.py
│   └── sinks.py
└── anemoi/
    ├── __init__.py      # empty (package marker only)
    ├── blocks.py        # moved from fiab_plugin_anemoi/blocks.py
    └── utils.py         # moved from fiab_plugin_anemoi/utils.py
```

## Components

### `fiab_plugin_ecmwf/anemoi/blocks.py`
Moved verbatim from `fiab_plugin_anemoi/blocks.py`. No import changes needed -- it already imports `QubedInstanceOutput` from `fiab_plugin_ecmwf.metadata` and its own `utils` via relative import.

### `fiab_plugin_ecmwf/anemoi/utils.py`
Moved verbatim from `fiab_plugin_anemoi/utils.py`. No import changes needed.

### `fiab_plugin_ecmwf/__init__.py`
Adds `anemoiSource` and `anemoiTransform` to the existing `blocks` dict:

```python
from fiab_plugin_ecmwf.anemoi.blocks import AnemoiSource, AnemoiTransform

blocks = {
    "ekdSource": EkdSource(),
    "ensembleStatistics": EnsembleStatistics(),
    "temporalStatistics": TemporalStatistics(),
    "zarrSink": ZarrSink(),
    "anemoiSource": AnemoiSource(),
    "anemoiTransform": AnemoiTransform(),
}
```
sib
### `fiab-plugin-ecmwf/pyproject.toml`
Two new optional extras:
- `anemoi = ["earthkit-workflows-anemoi>=0.4.0"]` -- compile-time dep
- `anemoi-runtime = ["anemoi-inference>=0.10.0"]` -- runtime dep

## Configuration changes

### `install/plugins.json`
Remove the `ecmwf-anemoi` entry. The Anemoi blocks are now part of `ecmwf-base`.

### `backend/pyproject.toml`
- Remove `fiab-plugin-anemoi` from `[tool.uv.workspace].members`
- Remove `fiab-plugin-anemoi` from `[tool.uv.sources]`
- Replace `fiab-plugin-anemoi[runtime]` in `[dependency-groups.dev]` with `fiab-plugin-ecmwf[anemoi,anemoi-runtime]`

## Deletion

The entire `backend/packages/fiab-plugin-anemoi/` directory is deleted.

## Testing

Existing `fiab-plugin-ecmwf` tests are unchanged. No new tests are required for the move itself -- the Anemoi blocks have no test suite in `fiab-plugin-anemoi` and the move is mechanical.

# earthkit-workflows graph construction optimizations -- overview

This is the entry point for a set of change specs that reduce the cost of building
fluent graphs in earthkit-workflows (ekw). Each `ekw-optimization-*.md` file in this
folder describes one self-contained change. This file gives the shared context, the
dependencies between the specs and the measurement procedure.

## Motivation

The perf case `fiab-plugin-ecmwf/ifsOperational2select2mapAndGrib` (currently marked
`skipped` in `backend/packages/fiab-plugin-ecmwf/tests/perf/ifsOperational2select2mapAndGrib.json`)
spends about 178 s in `OperationalForecastSource.compile` alone. Profile (pyinstrument,
`just pluginProf fiab-plugin-ecmwf/ifsOperational2select2mapAndGrib/source/compile`):

```
178.4  OperationalForecastSource.compile
171.0    earthkit.workflows._qubed.expand_as_qube
170.0      Action.expand -> Action.transform -> _expand_transform -> Action.map
164.2        fluent.Node.__init__                      (cumulative)
 83.7          pydantic model_copy / __deepcopy__ / copy.deepcopy
 51.3          create_task_instance                    (contains one of the deep copies)
 50.9          _resolve_node_metadata
 35.1          pydantic BaseModel.__init__ (self 27.3) + validate_python (7.8)
 11.5          pydantic __str__/__repr__ (via custom_hash)
  ~7         xarray / DataTree bookkeeping (isnull, concat, combine_by_coords)
```

The graph is large. The source block builds the whole ifs-ens catalogue for one base
time: roughly 780k `take` nodes (enfo pl alone is 85 steps x 9 params x 14 levels x 50
members). That puts the cost at about 0.21 ms per node. Nothing large is copied. The
time goes into a constant, wasteful amount of per-node work: two deep copies of a small
`TaskInstance`, 10+ throwaway pydantic model validations for metadata, and one full
pydantic `repr` plus sha256 for the node name. Within a single `Action.map` call, all of
this work gives the same result for every node.

Not building the whole catalogue (pushing downstream selection into the source) is the
biggest win, but it is out of scope here. These specs make per-node construction cheap
and leave the size of the graph unchanged.

## Code location

All the touched code except one fiab hotfix lives in the `earthkit-workflows`
distribution. That distribution ships both `earthkit.workflows` and `cascade`. Line
references are against `earthkit-workflows==0.19.0` as installed in `backend/.venv`:

- `earthkit/workflows/fluent.py` -- `Node`, `create_task_instance`, `_resolve_node_metadata`, `Action.map/reduce/broadcast/transform/join`, `_expand_transform`, `merge`
- `earthkit/workflows/metadata.py` -- `NodeMetadata`, `Requirements`, `Artifacts`, `BuilderMetadata`, `update_*`
- `earthkit/workflows/_qubed.py` -- `expand_as_qube`
- `earthkit/workflows/nodetree.py` -- `nodetree_from_dict`
- `cascade/low/core.py` -- `TaskInstance`, `TaskDefinition`
- fiab: `backend/src/forecastbox/domain/run/compile.py::_hotfix_gpu_availability` mutates task definitions after graph construction

## Specs and dependencies

| file | summary | depends on | expected gain (this case) |
|---|---|---|---|
| `ekw-optimization-sealedPayloads.md` | make payloads and metadata immutable after construction ("sealed"), shallow-share them, remove the redundant deep copies | -- | most of the 84 s deepcopy |
| `ekw-optimization-nodeMetadata.md` | resolve `NodeMetadata` once per call site instead of per node, share sealed instances | sealedPayloads (for sharing) | most of the 51 s |
| `ekw-optimization-nodeNaming.md` | compute the payload digest once, derive node names cheaply | sealedPayloads (for caching the digest) | most of the 11.5 s, plus sha256 cost |
| `ekw-optimization-preparedPayload.md` | factor `Node.__init__` into a per-call `prepare` step and a per-node `bind` step, used by `map`/`reduce`/`broadcast` | all three above | ties the above together and removes the remaining per-node overhead |
| `ekw-optimization-expansionStructure.md` | smaller structural fixes in `expand_as_qube`, `transform`, `nodetree_from_dict` | -- | a few seconds, more for larger fan-outs |

Suggested order: sealedPayloads, then nodeMetadata and nodeNaming (in parallel), then
preparedPayload, with expansionStructure at any point. Each spec should be a separate PR
to earthkit-workflows with its own before/after measurement.

## Design principle for sharing

Shallow copies and shared instances are preferred over deep copies. Any structure
shared between nodes must be immutable. If a caller later attempts an in-place
mutation, it must crash loudly rather than silently change many nodes at once. A caller
that needs a modified version creates a new copy explicitly (`model_copy(update=...)`
or `model_copy(deep=True)`). True copy-on-write is not attempted.

## Measuring

- Wall time: `just pluginPerf` (the case must be un-skipped locally, or run directly via `pluginProf`).
- Profile: `just pluginProf fiab-plugin-ecmwf/ifsOperational2select2mapAndGrib/source/compile` (pyinstrument), and `--profiler cprofile` for call counts.
- Correctness: the graph must stay equivalent. A useful check is to compile the perf blueprint before and after, then compare `graph2job(...)` outputs modulo task ids. Same tasks multiset, same edge structure, same `static_input_*` and definitions. All specs are designed to keep task ids byte-identical, and that is the cheapest regression check. The only exception is the optional deterministic environment ordering in `ekw-optimization-nodeMetadata.md` and the out-of-scope items listed in `ekw-optimization-nodeNaming.md`. Those should land together in a dedicated PR.
- Memory: record peak RSS before and after (e.g. `/usr/bin/time -v`). Sharing should reduce it noticeably.

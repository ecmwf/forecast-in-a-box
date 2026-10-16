# ekw optimization: metadata models as frozen slotted dataclasses

See `ekw-optimization-overview.md` for context and measurement. This spec relates
closely to `ekw-optimization-nodeMetadata.md`: it changes the data types, while that
spec changes how and how often they are resolved. Implement this spec first. The
nodeMetadata spec then becomes simpler: no `model_construct` and no explicit sealing
for metadata (see "Interplay" below).

## Problem

`earthkit/workflows/metadata.py` defines `Requirements`, `Artifacts`, `BuilderMetadata`
and `NodeMetadata` as pydantic models (`CascadeBaseModel`, `extra="forbid"`). These
are plain value objects. Nothing in ekw, cascade, fiab or the plugins uses them for
serialization, JSON schema or as fields of other pydantic models. Every construction
still pays full pydantic validation, and `NodeMetadata()` triggers three more
validations through its `default_factory` sub-models. In the perf case this happens
about 13 times per node (see nodeMetadata spec). It is the bulk of the ~35 s spent in
`BaseModel.__init__` + `validate_python`, plus ~8.5 s of validated `__setattr__` in the
in-place `update_*` merges.

The pydantic models are also mutable, which blocks safe sharing between nodes.

## Goal

- Replace the four classes with `@dataclass(frozen=True, slots=True, kw_only=True)`.
- Keyword construction stays source-compatible for all existing callers (see the inventory below).
- Make instances immutable and hashable, so they can be shared freely between nodes
  and used as memoization keys.
- Replace in-place merging with pure merge functions.
- Keep the useful part of pydantic's validation as light checks in `__post_init__`.

## Design

### Classes

```python
@dataclass(frozen=True, slots=True, kw_only=True)
class Requirements:
    """pip-installable packages required by the task, and whether it needs a GPU."""
    environment: tuple[str, ...] = ()
    needs_gpu: bool | None = None

@dataclass(frozen=True, slots=True, kw_only=True)
class Artifacts:
    """Mapping of artifact names to their URLs."""
    artifact_urls: Mapping[str, str] = <empty FrozenDict>

@dataclass(frozen=True, slots=True, kw_only=True)
class BuilderMetadata:
    """Identifier of the block that generated the node."""
    blockId: str | None = None

@dataclass(frozen=True, slots=True, kw_only=True)
class NodeMetadata:
    requirements: Requirements = EMPTY_REQUIREMENTS
    artifacts: Artifacts = EMPTY_ARTIFACTS
    builder: BuilderMetadata = EMPTY_BUILDER
```

Notes:
- Field descriptions currently in `Field(description=...)` move into the class docstrings.
- Defaults for `NodeMetadata` are module-level empty singletons, not `default_factory`.
  This is allowed because they are frozen and hashable. `dataclasses` only rejects
  defaults whose `__hash__` is `None`. As a result, `NodeMetadata()` allocates one
  object instead of four.
- `kw_only=True` keeps positional construction impossible, which matches pydantic
  behaviour. All current callers use keywords.

### Normalization and validation in `__post_init__`

Pydantic currently coerces and validates input. The replacement does the following,
using `object.__setattr__` because the classes are frozen:

- `Requirements.environment`: accept any iterable of `str` and store it as `tuple`.
  **Reject a bare `str`** with `TypeError`. Otherwise `Requirements(environment="numpy")`
  silently becomes `("n", "u", "m", ...)`. Pydantic rejects this case today. Also check
  that each element is a `str`.
- `Requirements.needs_gpu`: `bool | None`, checked with `isinstance`. Pydantic's lax
  mode accepted e.g. `"true"` or `1`. If any caller relies on that, it will now get a
  `TypeError`. The grep below found none.
- `Artifacts.artifact_urls`: accept any `Mapping[str, str]` and store it as a
  `FrozenDict` (the helper from `ekw-optimization-sealedPayloads.md`; if that spec has not
  landed yet, introduce the helper here). It must be hashable for the dataclass hash to
  work: give `FrozenDict` a `__hash__` over `frozenset(self.items())`. Do not use
  `types.MappingProxyType`, because it cannot be pickled.
- `BuilderMetadata.blockId`: `str | None`.
- `NodeMetadata`: for backward compatibility with the documented
  `NodeMetadataContext(requirements={"environment": [...]}, artifacts={}, builder={})`
  usage (see the `NodeMetadataContext` docstring), accept a `Mapping` for each
  sub-field and convert it via `Requirements(**m)` etc. Otherwise require the exact
  type.

Unknown keyword arguments raise `TypeError` from the generated `__init__`, which
replaces pydantic's `extra="forbid"`.

### Pickling

Frozen slotted dataclasses pickle via `__getstate__`/`__setstate__`. That path bypasses
`__post_init__`, and `FrozenDict.__reduce__` intentionally thaws to a plain `dict` (see
the sealedPayloads spec). So after a pickle round trip, `Artifacts.artifact_urls` would
be a mutable `dict`. Fix this by defining `__reduce__` on the four classes, returning
`(_rebuild, (cls, {f.name: getattr(self, f.name) for f in fields(self)}))` where
`_rebuild(cls, kw)` calls `cls(**kw)`. This re-runs normalization. Nothing in fiab
pickles nodes, but ekw graphs may be pickled by other users, e.g. dask backends.

### Merge functions

The in-place `update_requirements`, `update_artifacts`, `update_builder_metadata` and
`update_node_metadata` cannot work on frozen instances. Replace them with pure
`merge_*` functions that return new instances. Precedence and the
`ekw-optimization-nodeMetadata.md` short-circuit rules are unchanged: return an input
unchanged if the other is empty. With frozen instances this is safe.

- `merge_requirements(a, b)`: `environment` is the union of both. Use deterministic
  first-seen order, `tuple(dict.fromkeys(b.environment + a.environment))`, instead of
  today's `list(set(...))`. The ordering change affects task ids (see the nodeMetadata and
  nodeNaming specs), so ship it in the same release as any other id-changing change.
  `needs_gpu` is `b.needs_gpu or a.needs_gpu`, exactly as today, including the
  `None`/`False` behaviour.
- `merge_artifacts(a, b)`: `FrozenDict({**a.artifact_urls, **b.artifact_urls})`.
- `merge_builder_metadata(a, b)`: `b.blockId or a.blockId`.
- `merge_node_metadata(a, b)`: component-wise.

Remove the `update_*` functions. They are only used inside ekw (`fluent.py`). fiab and
the ecmwf/test plugins do not use them. Call this out in the ekw changelog as a breaking
change.

### Call sites in ekw to adapt

- `fluent._get_context_metadata`: fold the context stack with `merge_node_metadata`
  starting from `EMPTY_NODE_METADATA`. The thread-local cache stays.
- `fluent.NodeMetadataContext.__init__`: build `NodeMetadata(requirements=requirements or EMPTY_REQUIREMENTS, ...)`.
- `fluent._resolve_node_metadata`: rewrite with `merge_*` (or replace it with the
  nodeMetadata spec's `resolve_node_metadata`). `Requirements(**getattr(payload, "_cascade", {}))`
  stays, but see the `mark` note below.
- `fluent.create_task_instance`:
  - `requirements = requirements or Requirements()` becomes `requirements or EMPTY_REQUIREMENTS`.
  - The in-place `update_requirements(requirements, ...)` for `TaskInstance` payloads
    becomes `requirements = merge_requirements(requirements, Requirements(environment=..., needs_gpu=...))`.
    This also removes today's side effect on the caller's object.
  - The three `requirements.model_dump(exclude_none=True)` calls are replaced by a helper
    `_definition_kwargs(req) -> dict` that returns `{"environment": list(req.environment)}`
    plus `"needs_gpu": req.needs_gpu` if it is not `None`. **`environment` must be
    converted to `list`.** `TaskDefinition.environment` is `list[str]`, and the
    `model_copy(update=...)` path does not validate. A tuple there would make task
    definitions compare unequal to otherwise identical ones.
- `graph/nodes.py::Node.__init__`: `metadata or NodeMetadata()` becomes `metadata or EMPTY_NODE_METADATA`.
- `decorators.py`: `requirements or Requirements()` becomes `requirements or EMPTY_REQUIREMENTS`.
- `taskgraph.py` and `graph/export.py`: type hints only.
- `__init__`/`__all__` exports: add `EMPTY_*` and `merge_*`, remove `update_*`.

### `mark.py` note (pre-existing bug)

`mark.needs_cpu` stores `needs_cpu=True` in `func._cascade`, which is later used as
`Requirements(**_cascade)`. `Requirements` has no `needs_cpu` field and forbids extra
keys, so this already raises today (pydantic `ValidationError`). After the change it
raises `TypeError` instead. Either add the field, drop the decorator, or filter
unknown keys with a warning. This is a decision for ekw maintainers, and it can be
fixed in the same PR.

## Usage inventory (all keyword construction, read-only access)

- fiab `backend/src/forecastbox/domain/run/compile.py`: `NodeMetadataContext(builder=BuilderMetadata(blockId=...))`,
  reads `node.metadata.builder.blockId` and `node.metadata.artifacts.artifact_urls.keys()`.
- fiab-core `tools/plugins.py`: `NodeMetadataContext(requirements=Requirements(environment=<list>))`.
- fiab-plugin-ecmwf: `Requirements(environment=<list>)`, `Requirements()`,
  `NodeMetadata(requirements=...)`, `Artifacts(artifact_urls={...})`
  (`blocks.py`, `output/blocks.py`, `plotting/blocks.py`, `anemoi/blocks.py`).
- fiab-plugin-test: `NodeMetadataContext(requirements=Requirements(environment=...))`, `NodeMetadataContext(artifacts=Artifacts(artifact_urls={...}))`.
- ekw plugins `anemoi/fluent.py`, `pproc/fluent.py`: `Requirements(environment=...)`,
  `Requirements(needs_gpu=True)`, pass-through of `Requirements | None` / `Artifacts | None`.

None of these use `model_dump`, `model_copy`, `model_validate` or in-place mutation of
these classes. Nothing in the fiab backend needs to change. Plugins only need a
version bump to pick up the new ekw.

## Interplay with other specs

- `ekw-optimization-nodeMetadata.md`: the `model_construct` advice and the explicit
  `seal(...)` calls for metadata go away. Frozen dataclasses are immutable and cheap to
  construct. The hoisting and short-circuit parts stay. Hashability also allows a simple
  memoization key `(id(payload), context_metadata, node_metadata)` if needed.
- `ekw-optimization-sealedPayloads.md`: shares `FrozenDict`. Sealing still applies to
  `TaskInstance`/`TaskDefinition`, which stay pydantic.
- `ekw-optimization-preparedPayload.md`: `PreparedPayload.metadata` holds a shared frozen instance.

## Tests

- Construction: defaults, keyword args, list/tuple/generator for `environment`,
  rejection of a bare `str` and of non-str elements, `needs_gpu` type check, unknown
  kwarg raises, Mapping conversion in `NodeMetadata` (docstring example of
  `NodeMetadataContext`).
- Immutability: attribute assignment raises `FrozenInstanceError`, and
  `artifact_urls[...] = ...` raises.
- Equality and hash: equal values compare equal and hash equal, regardless of the input
  container type (list vs tuple, dict vs FrozenDict).
- Pickle and `copy.deepcopy` round trips keep the type, keep immutability and compare equal.
- `merge_*` precedence matrix, matching the current `update_*` semantics apart from
  environment ordering.
- `create_task_instance`: `TaskDefinition.environment` is a `list`; the caller's
  `requirements` is not modified; definitions compare equal to the ones produced by
  the old implementation, modulo environment ordering.
- fiab: existing compile tests pass (`blockId` and artifact extraction).

## Expected effect

Without the nodeMetadata hoisting: each of the ~13 per-node metadata constructions
drops from pydantic validation cost (several microseconds, with default sub-model
factories) to a slotted dataclass init with a short `__post_init__` (sub-microsecond to
about a microsecond). The `update_*` setattr cost is replaced by a few allocations,
often short-circuited. The rough estimate for the perf case is 25-35 s of the current
178 s; measure it in the PR. With hoisting, the per-node share is near zero either way,
and the main benefit becomes simpler, safer sharing.

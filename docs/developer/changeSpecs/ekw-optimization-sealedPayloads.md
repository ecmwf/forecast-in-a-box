# ekw optimization: sealed payloads, shallow sharing, no redundant deep copies

See `ekw-optimization-overview.md` for context and measurement.

## Problem

Each `fluent.Node(...)` with a `TaskInstance` payload performs two full deep copies of
the payload:

1. `create_task_instance` (fluent.py ~L163-167): `task = payload.model_copy(deep=True)`, followed by
   `task.definition = task.definition.model_copy(update=requirements.model_dump(exclude_none=True))`.
2. `Node.__init__` (fluent.py ~L207): `task = task.model_copy(deep=True)` again, unconditionally.
   For a `TaskInstance` payload this copies the copy made in step 1.

The copies exist because `Node.__init__` then mutates the task in place:
- fills `definition.input_schema` / `definition.output_schema` if empty,
- inserts `Node.Index(i)` placeholders into `static_input_ps`,
- replaces every `Node.Index` in `static_input_ps` with `None`.

Each mutation is local to the new node and has the same result for every node created
from the same payload with the same number of inputs and outputs. In
`_expand_transform` -> `map` this is every node of the call. The profile attributes about
84 s of 178 s to `model_copy`/`__deepcopy__`/`copy.deepcopy`. The memo bookkeeping alone
(`dict.get`, `id`, `_keep_alive`) accounts for more than 20 s of self time.

## Goal

- At most one deep copy per distinct (payload, num_inputs, num_outputs) per call site, instead of two per node.
- The resulting task object is shared by all nodes that use it.
- Shared task objects are immutable: any later in-place mutation attempt raises.
- Callers that need a modified task create one explicitly via `model_copy`.

This spec only provides the sealing mechanism and removes the redundant copy inside
`Node.__init__`. The per-call sharing in `map`/`reduce`/`broadcast` is wired in by
`ekw-optimization-preparedPayload.md`. Sealing on its own already removes one of the two
deep copies per node.

## Mechanism: sealing

### Constraints, verified against pydantic 2.13 in our venv

- Pydantic's `BaseModel.__eq__` compares `__dict__`, `__pydantic_private__` and `__pydantic_extra__`.
  A `PrivateAttr` flag such as `_sealed` would therefore make a sealed and an unsealed
  instance compare unequal. That breaks `graph.deduplicate.same_payload` and `Graph.__eq__`.
  **Do not use a private attribute or a separate subclass as the seal marker.** A subclass
  breaks equality as well, because pydantic compares types.
- Field validation of `dict[str, Any]` / `list[...]` fields builds new plain containers.
  Frozen containers passed at construction time are therefore silently thawed. Sealing
  must happen after construction, through direct `__dict__` manipulation.
- A dict subclass that blocks `__setitem__` breaks `copy.deepcopy` and `pickle` unless it
  defines `__reduce__` and `__deepcopy__`. The default reconstruction calls `__setitem__`.

### Chosen design

Add to ekw (suggested module `earthkit/workflows/_frozen.py`; it must be importable from
`cascade.low` too, so placing it in `cascade/low/frozen.py` is equally fine):

- `FrozenDict(dict)`: overrides `__setitem__`, `__delitem__`, `update`, `pop`, `popitem`,
  `clear`, `setdefault`, `__ior__` to raise `TypeError("sealed: ... create a copy via model_copy")`.
  `__reduce__` returns `(dict, (dict(self),))`. `__deepcopy__` returns a plain `dict`
  with deep-copied keys and values. `__copy__` returns a plain `dict`.
- `FrozenList(list)`: overrides `__setitem__`, `__delitem__`, `append`, `extend`, `insert`,
  `remove`, `pop`, `clear`, `sort`, `reverse`, `__iadd__`, `__imul__` to raise. It has the
  same `__reduce__`/`__deepcopy__`/`__copy__` policy, which returns a plain `list`.
- `seal(model: BaseModel) -> model`: recursively, in place:
  - for each field value: a nested `BaseModel` is sealed recursively, a `dict` is
    replaced by `FrozenDict` (with values sealed recursively), a `list` is replaced by
    `FrozenList` (likewise). Tuples, scalars and str are left as they are. Other objects
    (e.g. arbitrary user objects inside `static_input_ps`) are left as they are and
    documented as not protected.
  - finally `object.__setattr__(model, "__dict__", FrozenDict(model.__dict__))`.
  - idempotent: returns immediately if `type(model.__dict__) is FrozenDict`.
- `is_sealed(model) -> bool`: `type(model.__dict__) is FrozenDict`.

I verified the behaviour with a quick experiment on `cascade.low.core.TaskInstance`:
- `sealed.definition.needs_gpu = False` raises, because pydantic's
  `_model_field_setattr_handler` does `self.__dict__[name] = val`.
- Attribute reads, `==` against an equal unsealed instance, `model_dump`,
  `model_dump_json` and `pickle` round-trips all work. A pickle round-trip and
  `model_copy(deep=True)` both give back a plain mutable instance.
- `model_copy()` (shallow) gives a mutable top level but shares the sealed nested
  containers. `model_copy(update=...)` likewise. This is the intended copy-what-you-change semantics.

Caveats to document in the docstrings:
- `object.__setattr__(m, "x", v)` and direct writes to `m.__dict__` via C-level APIs
  bypass the seal. Pydantic's `_object_setattr` is used only internally, in
  construction/copy paths, and those always produce new instances.
- Objects inside `static_input_ps`/`static_input_kw` that are neither dict, list nor
  BaseModel (e.g. numpy arrays, user dataclasses) are shared but not protected.
  `Node.Index` is replaced by `None` before sealing, so it is not affected.
- msgpack/orjson serialization of `FrozenDict`/`FrozenList`: as dict/list subclasses they
  should serialize natively, but this must be checked in a unit test
  (`cascade.gateway.client` uses `model_dump` plus orjson).

## Changes in ekw

1. `create_task_instance`, `TaskInstance` branch: keep exactly one copy. Replace
   `payload.model_copy(deep=True)` and the follow-up definition copy with a single
   `payload.model_copy(deep=True)` and an in-place update of the copy's definition fields
   (the copy is private at this point). Alternatively, keep the deep copy and do
   `task.definition = task.definition.model_copy(update=...)`. Either way the result is
   one deep copy.
2. `Node.__init__`: drop the unconditional `task = task.model_copy(deep=True)`.
   `create_task_instance` already returns a fresh instance in all three branches (str,
   callable, TaskInstance). It then mutates it as today and calls `seal(task)` before
   `super().__init__(..., payload=task, ...)`.
3. `Node.Index` is a mutable dataclass, and today it is compared via `in task.static_input_ps.values()`.
   Make it `@dataclass(frozen=True)`. It is used as a sentinel only and nothing mutates it.
4. `Node._for_copy` holds the original (unsealed, caller-owned) payload. Keep it as is.
   `Node.copy()` re-runs `__init__`, which copies again. That path is rare.

After this spec alone, each node costs one deep copy instead of two, plus a cheap seal
walk over about 20 objects. The full win comes with `preparedPayload`, where the copy and
seal happen once per call site.

## Known mutators that will now crash (must be fixed in the same release train)

Repo-wide grep over ekw, cascade, fiab and its plugins, looking for in-place mutation of
node payloads after `Node` creation:

- **fiab** `backend/src/forecastbox/domain/run/compile.py::_hotfix_gpu_availability`:
  `taskInstance.definition.needs_gpu = False` for every task of the `JobInstance`.
  `cascade.low.into.graph2job` puts the node payload objects into `JobInstance.tasks`
  without copying (pydantic `revalidate_instances='never'`, verified), so these are the
  sealed objects. Rewrite as
  `job_instance.tasks[tid] = t.model_copy(update={"definition": t.definition.model_copy(update={"needs_gpu": False})})`.
  This must land in fiab before, or together with, the ekw version bump. Add a fiab
  test that compiles a graph and runs the hotfix on it.
- `earthkit/workflows/graph/deduplicate.py::_DedupTransformer.node` assigns `node.inputs = inputs`.
  This is on the `Node`, not the payload, so it is unaffected.
- `plugins/pproc/fluent.py` ~L746: `operation.static_input_kw.setdefault("metadata", {}).update(...)`
  mutates a caller-owned `TaskInstance` before it is passed to `_wrapped_reduction`. It is
  unaffected as long as user-supplied payloads are never sealed in place. The seal is only
  ever applied to ekw's own private copy. Add a regression test for exactly this pattern:
  build a node from a payload, then mutate the original payload, and check the node is
  unchanged and nothing raises.
- `cascade/low/dask.py::task2task` mutates a freshly built `TaskInstance`. Not a node payload, unaffected.

Any other mutator found later is, by design, a crash with a clear message rather than a
silent mass overwrite.

## Tests

- Unit tests for `FrozenDict`/`FrozenList`/`seal`: every mutator raises; `deepcopy`,
  `copy`, `pickle`, `cloudpickle`, `model_dump`, `model_dump_json`, orjson and msgpack
  give plain values; equality with unsealed equivalents holds; `seal` is idempotent.
- `Node` payload is sealed; the caller's payload object is untouched and still mutable.
- `deduplicate_nodes` deduplicates the same pairs as before (equality preserved).
- Graph equivalence on the perf blueprint (see overview): identical `graph2job` output,
  including task ids.

## Risks

- External ekw users that mutate `node.payload` after construction will now crash. That
  is intended, but it needs a changelog entry and a minor version bump of ekw.
- `__dict__` replacement is unconventional. If a future pydantic version stops routing
  field assignment through `self.__dict__[name] = ...`, the seal would silently stop
  protecting attribute assignment. A unit test asserting that the assignment raises
  guards this.

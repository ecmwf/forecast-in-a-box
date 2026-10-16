# ekw optimization: prepared payloads (per-call prepare, per-node bind)

See `ekw-optimization-overview.md` for context and measurement. This spec builds on
`ekw-optimization-sealedPayloads.md`, `ekw-optimization-nodeMetadata.md` and
`ekw-optimization-nodeNaming.md`, and it is the place where their savings become
per-call instead of per-node.

## Problem

`fluent.Node.__init__` does two kinds of work at once:

- **payload-dependent work**: metadata resolution, task instance creation, deep copy,
  schema fill, `static_input_ps` placeholder insertion and rewriting, task repr for the
  name hash. This depends only on `(payload, len(inputs), num_outputs, name, node_metadata,
  context metadata)`.
- **node-dependent work**: wiring the concrete inputs, computing the node name from the
  input names, creating the `BaseNode`.

`Action.map`, `reduce` and `broadcast` call `Node(...)` in a loop where the
payload-dependent part is constant. That part is where nearly all of the 164 s in
`Node.__init__` goes, for about 780k nodes in the perf case.

## Design

### `PreparedPayload`

A new internal frozen dataclass in `fluent.py`:

```python
@dataclass(frozen=True, slots=True)
class PreparedPayload:
    task: TaskInstance                 # sealed; static_input_ps already rewritten (Node.Index -> None)
    metadata: NodeMetadata             # sealed, resolved
    outputs: list[str] | None          # node_outputs as computed today from num_outputs
    num_inputs: int
    input_positions: tuple[tuple[str, int], ...]   # (static_input_ps key, index into inputs)
    name_prefix: str                   # explicit name, else definition.func, else definition.entrypoint
    name_hasher: "hashlib._Hash"       # sha256 pre-fed with f"{task}", see nodeNaming spec
    source: tuple[Payload, int]        # (original payload, num_outputs), for Node.copy()
```

`outputs` should be a tuple, or copied on bind. `BaseNode` stores `self.outputs` as a
list, and code elsewhere calls `.copy()` on it. Do not share one mutable list between
nodes.

### `prepare_payload(payload, num_inputs, num_outputs=1, name=None, metadata=None) -> PreparedPayload`

This is the current body of `Node.__init__` with `inputs` replaced by `num_inputs`:

1. `resolved = resolve_node_metadata(payload, metadata)` (nodeMetadata spec).
2. `task = create_task_instance(payload, requirements=resolved.requirements)`. This
   returns a fresh private instance, with exactly one deep copy for `TaskInstance`
   payloads (sealedPayloads spec).
3. Schema fill, exactly as today.
4. Placeholder insertion: for `i in range(num_inputs)`, insert `Node.Index(i)` unless it
   is already present. This is identical to today's loop, which only uses `len(inputs)`.
5. Rewrite: for each `(pos, Node.Index(k))`, check `k < num_inputs` (raise as today),
   record `(pos, k)` in `input_positions`, and set `task.static_input_ps[pos] = None`.
6. `seal(task)`.
7. Name prefix and hasher, exactly as in the nodeNaming spec.

### Binding: `Node.from_prepared(prepared, inputs) -> Node`

1. Normalize `inputs` to a list (`Input` -> `[Input]`) and assert `len(inputs) == prepared.num_inputs`.
2. `node_inputs = {pos: inputs[k] for pos, k in prepared.input_positions}`.
3. Name: `prepared.name_prefix + h.hexdigest()`, where `h = prepared.name_hasher.copy()`
   updated with the input-name string, formatted exactly as today.
4. `BaseNode.__init__(self, name, outputs=list(prepared.outputs) if ... else None, payload=prepared.task, metadata=prepared.metadata, **node_inputs)`.
5. `self._for_copy = (prepared, inputs)`.

Implement it via `cls.__new__(cls)` plus a private `_bind`. Alternatively, let `__init__`
accept a `PreparedPayload` as its `payload` argument (the `isinstance` dispatch is
cheap). Choose whichever keeps `Node`'s public constructor signature unchanged.

### `Node.__init__` stays backward compatible

`Node(payload, inputs, num_outputs, name, metadata)` becomes
`prepare_payload(...)` followed by `_bind(...)`. External callers (plugins, pproc, anemoi)
keep working unchanged and still get correct but per-node-expensive behaviour.

`Node.copy()` uses `_for_copy`. With a prepared payload it rebinds the same
`PreparedPayload` to the same inputs. That is cheap and gives an identical result,
because the prepared task is sealed.

### Call sites

- `Action.map`: if `payload` is a single `Payload`, prepare once before the loop with
  `num_inputs=1` and the given `num_outputs`, `node_metadata`. If it is an array of
  payloads, prepare per element, memoized by `id(element)` within the call, because
  arrays often repeat the same object.
- `Action.reduce`: `payload = create_task_instance(payload)` happens once per path today.
  Prepare once per distinct `inputs` length (the size of the reduced dim), memoized
  within the call. Batched reductions go through `_batch_transform`, which calls `reduce`
  again, so they are covered too.
- `Action.broadcast`: today it builds a **new** `create_task_instance(backends.method, static_input_ps=["trivial"])`
  inside the per-node loop. Hoist it out and prepare once per path.
- `fluent.from_source`: payloads are distinct per node, so it keeps calling `Node(...)`.
  There is no regression, since it still benefits from the cheaper internals.
- `_expand_transform`: builds one `create_task_instance(...)` per param and calls `map`.
  That is already per call, so no change is needed.
- Other `Node(...)` call sites in `fluent.py` and plugins: leave unchanged. Optionally
  migrate hot ones later, guided by profiles.

### Thread-safety and context

A `PreparedPayload` captures the context metadata at prepare time. Within one `map` call
nothing can change it, since the stack is thread-local and the loop does not enter
contexts. Do not cache `PreparedPayload`s across calls: the context may differ, and
callers may mutate their (unsealed) payload objects between calls (see the pproc pattern
in the sealedPayloads spec).

## Memory

Per node, the remaining allocations are: the `Node` object and its `__dict__`, the
`inputs` dict, the `Output` objects, the `outputs` list and the name string. Task and
metadata are shared. Peak RSS for the perf case should drop substantially. Record it in
the PR.

Optional follow-up, not part of this spec: `__slots__` on `fluent.Node`/`BaseNode`.
Check subclasses first (`taskgraph.Task` adds attributes) and anything that sets ad-hoc
attributes on nodes.

## Tests

- `Node(payload, inputs, ...)` and `Node.from_prepared(prepare_payload(payload, len(inputs), ...), inputs)`
  give equal nodes: same name, same `inputs` mapping, payload `==`, metadata `==`.
- `map` with a scalar payload: all nodes share `payload` and `metadata` (`is`), names
  are unique and identical to the legacy computation.
- `map` with an array of payloads, `reduce` with varying input counts, `broadcast`.
- Index-out-of-range error still raised with the same message.
- `Node.copy()` on prepared nodes.
- Graph equivalence on the perf blueprint: byte-identical `graph2job` output, unless the
  environment-ordering change from the nodeMetadata spec landed in between.

## Expected effect

With the three prerequisite specs, the per-node cost in `map` drops to binding plus
`BaseNode.__init__`, an estimated order of 10 microseconds or less (to be measured). The about 164 s of
`Node.__init__` in the perf case should drop to a few seconds, leaving xarray/DataTree
bookkeeping as the dominant remaining cost (see `ekw-optimization-expansionStructure.md`).

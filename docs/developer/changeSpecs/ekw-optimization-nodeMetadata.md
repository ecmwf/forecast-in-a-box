# ekw optimization: node metadata resolution

See `ekw-optimization-overview.md` for context and measurement. Sharing relies on
`ekw-optimization-sealedPayloads.md` (the `seal` helper). If
`ekw-optimization-metadataDataclasses.md` lands first (recommended), the metadata types
are frozen dataclasses and the pure merge functions are already defined there. The
`model_construct` and `seal` advice below then does not apply. The hoisting (sections
3-5) remains the relevant part of this spec.

## Problem

`fluent._resolve_node_metadata` (fluent.py ~L121) runs once per node and costs about 51 s
cumulative in the profile, most of it in pydantic `BaseModel.__init__` and
`validate_python`. Per node it does the following:

- `NodeMetadata()`: 1 validation plus 3 `default_factory` sub-model validations (`Requirements`, `Artifacts`, `BuilderMetadata`).
- `Requirements(**getattr(payload, "_cascade", {}))`: 1 validation.
- `update_requirements(...)`: 2 pydantic `__setattr__` plus `list(set(a + b))`.
- `update_node_metadata(metadata, _get_context_metadata())`: the context result is cached per thread, but the merge (3 sub-updates, about 5 `__setattr__`) still runs per node.
- `update_node_metadata(metadata, node_metadata or NodeMetadata())`: a further 4 validations when `node_metadata` is None, which is the case in `_expand_transform`.
- for `TaskInstance` payloads: `NodeMetadata(requirements=Requirements(environment=..., needs_gpu=...))`, 4 more validations, plus another merge.

Then `create_task_instance(payload, requirements=metadata.requirements)`:
- for `TaskInstance` payloads, merges the payload's environment/needs_gpu into
  `requirements` **again**, in place. This mutates `metadata.requirements` of the node
  being built and constructs one more `Requirements(...)`.
- `requirements.model_dump(exclude_none=True)` for the definition update.

That comes to about 13 pydantic validations, 1 dump and about 15 validated setattrs per
node. Within a single `Action.map`/`reduce`/`broadcast` call the inputs are constant:
the payload (unless an array of payloads is given), the context stack and
`node_metadata`. So the result is the same for every node.

## Goal

- Resolve metadata once per call site, or at most once per distinct payload, instead of once per node.
- Make the merge itself cheap: no validation of already-validated inputs, no default sub-model construction when it is not needed.
- Share the resulting `NodeMetadata` between nodes as a sealed (immutable) instance.
- Stop `create_task_instance` from mutating the passed-in `requirements`.

## Design

### 1. Pure merge functions in `metadata.py`

Add pure counterparts that return new instances and do not mutate their arguments:

- `merge_requirements(a: Requirements, b: Requirements) -> Requirements`
- `merge_artifacts(a, b) -> Artifacts`
- `merge_builder_metadata(a, b) -> BuilderMetadata`
- `merge_node_metadata(a: NodeMetadata, b: NodeMetadata) -> NodeMetadata` ("b wins", same precedence as `update_node_metadata(a, b)` today)

Implementation notes:
- Build the results with `Model.model_construct(...)`. The inputs are already validated
  instances, so re-validation is pure overhead.
- Short-circuit: if `b` is "empty" (equal to the default), return `a` unchanged, and the
  other way round. With sealed/immutable instances returning an input is safe. An
  `_is_empty` check can compare against module-level sealed defaults.
- `environment` merging: today's `list(set(b + a))` gives a process-dependent order
  (str hashing is randomized per process). That order flows into
  `TaskDefinition.environment`, then into `repr(task)`, then into node names (see
  `ekw-optimization-nodeNaming.md`). Change it to a deterministic order: first-seen order
  via `dict.fromkeys(a + b)`, or `sorted(...)`. This changes the content of
  `environment` lists (order only). Coordinate with the nodeNaming spec, since both
  change task ids.
- Keep the old `update_*` functions for backwards compatibility. They are public names
  in `earthkit.workflows.metadata` and fiab does not use them. Reimplement them in terms
  of the pure ones (`mInto.__dict__.update(merge(...).__dict__)`-style assignment), or
  deprecate them.

### 2. Module-level sealed defaults

`EMPTY_REQUIREMENTS`, `EMPTY_ARTIFACTS`, `EMPTY_BUILDER`, `EMPTY_NODE_METADATA`, all
sealed. Use them instead of `NodeMetadata()` / `Requirements()` wherever a default is
only read. This applies to `_resolve_node_metadata`, `create_task_instance`
(`requirements or Requirements()`) and `BaseNode.__init__` (`metadata or NodeMetadata()`).

### 3. `resolve_node_metadata(payload, node_metadata) -> NodeMetadata` (sealed result)

Same precedence as today:

1. requirements from `payload._cascade` (the `mark` decorators),
2. context metadata (`_get_context_metadata()`, already cached per thread; seal the cached instance when it is created),
3. explicit `node_metadata`,
4. for `TaskInstance` payloads: the payload definition's `environment`/`needs_gpu`.

It is computed with the pure merges and short-circuits, then sealed. The function is
cheap enough to call per node as a stopgap. The intended usage is to call it once per
call site (see below).

### 4. Hoisting

Until `ekw-optimization-preparedPayload.md` lands, add a tiny per-call cache in
`Action.map`, `Action.reduce` and `Action.broadcast`. Compute
`resolved = resolve_node_metadata(payload, node_metadata)` once before the node loop and
pass it to `Node(...)` through a new keyword-only parameter `resolved_metadata`. When it
is given, `Node.__init__` skips its own resolution. For an array of payloads, resolve per
element, or memoize by `id(element)` within the call.

The context cannot change during the loop: the loop body never enters or exits a
`NodeMetadataContext`, and the context stack is thread-local.

### 5. `create_task_instance` must not mutate its inputs

Change the `TaskInstance` branch to compute
`merged = merge_requirements(requirements, Requirements.model_construct(environment=..., needs_gpu=...))`
without touching `requirements`. Then dump `merged`. Better still, `Node.__init__` passes
the already-resolved requirements, which already include the payload's own requirements
via step 4 of the precedence above, so the second merge is redundant. Remove it, or make
it a no-op when the result is already included.

Cache the `model_dump(exclude_none=True)` of a sealed `Requirements` on first use, e.g.
in a `WeakKeyDictionary`, or simply compute it once per call site in the prepare step.

## Sharing and mutation

After this change `node.metadata` is the same sealed object for all nodes of a call
site. Readers in fiab (`compile.py`: `node.metadata.builder.blockId`,
`node.metadata.artifacts.artifact_urls.keys()`) only read, so they are unaffected. ekw
already shares metadata in some paths (`graph/nodes.py::Node.copy`,
`graph/expand.py`), so sharing is not a new concept for consumers. Mutators found by
grep: only the `update_*` functions inside ekw, which are replaced as described. Any
external in-place mutation now raises, which is the intended behaviour (see the
overview).

`NodeMetadataContext.__init__` stores the user-provided sub-models in a fresh
`NodeMetadata`. Seal that instance as well, but not the user's sub-model objects.
Construct with copies, or with `model_construct` over their `__dict__`.

## Tests

- Precedence matrix: `_cascade` vs context vs `node_metadata` vs payload definition, for
  `environment` (union), `needs_gpu` (or), `blockId` (last non-None wins) and
  `artifact_urls` (dict update). The resolved values must match the current implementation,
  apart from environment ordering.
- Nested `NodeMetadataContext`s: inner overrides outer, same as today.
- `create_task_instance` does not mutate the passed `requirements`.
- All nodes of one `map` call share `node.metadata` (`is`), and the instance is sealed.
- Graph equivalence on the perf blueprint: identical `graph2job` output, apart from
  `environment` order if the deterministic ordering is adopted in this PR.

## Expected effect

Of the roughly 51 s in `_resolve_node_metadata` plus the share of `create_task_instance`
spent on requirements, the per-node part drops to roughly zero once hoisted. Without
hoisting (pure merges, model_construct, short-circuits only), expect a several-fold
reduction.

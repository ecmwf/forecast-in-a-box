# ekw optimization: node naming / hashing

See `ekw-optimization-overview.md` for context and measurement. This spec works on its
own. Its full benefit needs a place to keep the per-payload state, which
`ekw-optimization-preparedPayload.md` provides.

## Problem

`fluent.Node.__init__` (fluent.py ~L234-235) derives the node name, which later becomes
the cascade `TaskId`:

```python
name = name or task.definition.func or task.definition.entrypoint
name += custom_hash(f"{task}{[x.name if isinstance(x, BaseNode) else f'{x.parent.name}.{x.name}' for x in inputs]}")
```

`f"{task}"` invokes pydantic's `__str__` -> `__repr_str__` -> `__repr_args__`
recursively over `TaskInstance` -> `TaskDefinition` and all static inputs. This happens
per node. In the profile, `__str__`/`__repr__` cost about 11.5 s cumulative and
`custom_hash` (sha256 over the resulting string) another 1.7 s. `definition.func` is a
base64 cloudpickle string, and it appears both in the repr and in the name prefix, so the
hashed string is long.

Within one `map`/`reduce`/`broadcast` call the task is identical for all nodes. Only the
input names differ.

## Goal

- Compute the task repr and feed it into sha256 once per distinct task, not once per node.
- Keep node names **byte-identical** to today. Task ids then do not change, and graph
  equivalence can be checked by exact comparison.

## Design

sha256 is incremental and `hashlib` objects support `.copy()`. The name hash input is
`task_repr + inputs_repr`, so the task part can be pre-consumed once:

```python
# once per prepared task (see preparedPayload spec)
task_repr = f"{task}"                     # exactly as today
prefix_hasher = hashlib.sha256(task_repr.encode())
name_prefix = name or task.definition.func or task.definition.entrypoint

# per node
h = prefix_hasher.copy()
h.update(f"{[...input names exactly as today...]}".encode())
node_name = name_prefix + h.hexdigest()
```

This gives the same digest as `custom_hash(f"{task}{inputs}")`. The per-node cost drops
to one hasher copy, one short update and one hexdigest.

Requirements and notes:
- `task_repr` must be taken **after** all per-node-independent mutations of the task
  (input/output schema fill, `static_input_ps` rewriting), exactly at the point where
  today's code takes it. The task is identical across the nodes of a call only after
  that rewrite. This is why the natural home of this is the prepare step of
  `ekw-optimization-preparedPayload.md`.
- The task must be sealed (`ekw-optimization-sealedPayloads.md`), otherwise a later
  mutation would make the cached repr stale. Without the prepared-payload step, an
  interim implementation can keep a small per-call cache in `map`/`reduce`/`broadcast`.
  The cache value is `(task, prefix_hasher, name_prefix)` and lives as long as the call.
  Pydantic models are unhashable, so a `WeakKeyDictionary` keyed by task does not work.
  Do not store the hasher on the model as a private attribute either, since pydantic
  equality compares private attributes (see the sealedPayloads spec).
- Keep `custom_hash` as is for other callers.
- Add a unit test asserting that `Node(...).name` matches the legacy formula for a few
  payload kinds (str entrypoint, callable, TaskInstance, with and without explicit
  `name`, Node and Output inputs, multi-output).

## Out of scope, worth separate decisions

These would change task ids, so they are listed but not part of this spec:

- **Name prefix**: for callable payloads, the prefix is the full base64 cloudpickle
  string. For module-level functions pickled by reference it is short (about 100
  chars), but for closures or lambdas it can be kilobytes, and that inflates every
  `TaskId`, every edge, the compilation detail and the logs. A readable prefix such as
  `func.__qualname__` or the entrypoint would be better.
- **Canonical hash input**: `repr(task)` is not a stable canonical form. Arbitrary static
  input objects whose repr includes `id()` (default `object.__repr__`) make names
  process-dependent. So does environment ordering coming from `list(set(...))` (see
  `ekw-optimization-nodeMetadata.md`). A canonical serialization (e.g. `model_dump`
  with a sorted-keys JSON encoder and a fallback for non-JSON values) would be more
  robust, and also cheaper than pydantic repr.

If either is adopted, do it in one PR together with the environment-ordering change in
the nodeMetadata spec, so that task ids change only once.

## Expected effect

About 11.5 s of repr plus most of the 1.7 s of hashing becomes per-call instead of per-node.

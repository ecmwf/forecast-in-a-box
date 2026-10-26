# ekw optimization: structural fixes in expansion and node-tree handling

See `ekw-optimization-overview.md` for context and measurement. This spec is
independent of the other `ekw-optimization-*` specs. Its share of the current profile
is small, about 7-10 s of 178 s. Once the per-node costs are fixed by the other specs,
though, this becomes the dominant remaining cost, and parts of it grow quadratically
with fan-out.

## 1. `expand_as_qube`: merge only once

`earthkit/workflows/_qubed.py::expand_as_qube.expand_fn` ends every invocation with
`return fluent.merge(**leaves)`. The function recurses, but only the outermost return
value is used. Inner calls discard their merge result, yet each one still performs
`set_path` + `combine_by_coords` + `nodetree_from_dict` over all leaves collected so far.
For a chain-shaped qube (every `Qube.from_datacube` is a chain, about 12 levels deep
in the perf case) the merge runs about 12 times instead of once.

Change: make `expand_fn` only populate `leaves` (return `None`) and call
`fluent.merge(**leaves)` once in `expand_as_qube` after the recursion. Behaviour is
identical. Profile share: about 1.2 s (`merge` cumulative).

## 2. `Action.transform`: concatenate once, select once

`fluent.py::Action.transform`, per param:

```python
new_res = func(self.select(path=path), *param)
if dim_name not in nodetree_dimensions(new_res.nodes):
    new_res._add_dimension(dim_name, dim_values[index], axis, path=path, override=True)
res = new_res if res is None else res.join(new_res, dim_name)
```

Issues:
- `self.select(path=path)` is recomputed for every param, although it is the same for
  all of them. Each call builds a new `DataTree` via `nodetree_from_dict`, including its
  validation (see point 3).
- `res.join(new_res, dim)` concatenates pairwise and progressively. With P params and N
  nodes per param, it copies O(P^2 * N) object pointers and builds P intermediate trees,
  each validated in full. P is 50 for `number` in the perf case.
- `_add_dimension(..., path=path)` internally calls `self.select(path=path)` again and
  rebuilds the tree.

Changes:
- Compute `selected = self.select(path=path)` once, before the loop. Pass
  `type(self)(selected.nodes)` to `func` as a fresh `Action` wrapper per param. `func` may
  call mutating helpers (`_add_dimension`, `_squeeze_dimension`, `set_scalar_coords`
  reassign `self.nodes`) on the action it receives or on the one it returns, and a fresh
  wrapper keeps that from leaking across params. The underlying `DataTree` is not mutated
  in place by those helpers, since they build new trees. Verify that assumption for all
  helpers that `func` implementations in ekw and its plugins call.
- Collect the per-param results per node path in lists, then call `xr.concat` once per
  path, with the same arguments `join` uses today: `join="exact"`,
  `combine_attrs="no_conflicts"`, `coords="minimal"`, and the dim given as a name or as a
  `DataArray(values, name=dim)`. Keep `join` as is for external callers. Check
  equivalence: a single n-ary concat must give the same coords and order as the
  left-fold of binary concats. A unit test comparing both on mixed dim/coord cases
  covers this.
- Add the new dimension with `expand_dims` directly on the collected arrays instead of
  going through `_add_dimension`, which re-selects and rebuilds the tree.

Profile share today: `join` about 1.8 s plus part of the `nodetree_from_dict` time. The
gain grows with P.

## 3. `nodetree_from_dict`: avoid redundant validation

`earthkit/workflows/nodetree.py::nodetree_from_dict` runs
`np.any(leaf[name].isnull())` over every leaf on every call. On object arrays this goes
through pandas `isna` -> `_isna_string_dtype` (about 2.7 s self in the profile). The
function is called from nearly every `Action` operation (`select`, `map`, `join`,
`_add_dimension`, `_squeeze_dimension`, `set_scalar_coords`, `merge`), so a single
`transform` step validates the same arrays several times over.

Changes:
- Add a keyword-only parameter `validate: bool = True`. Internal call sites whose input
  arrays are known to contain only nodes pass `validate=False`. These are arrays built
  from `np.empty(..., dtype=object)` and fully filled, or obtained via
  `sel`/`isel`/`concat`/`squeeze`/`expand_dims` of already-valid arrays. Keep validation
  at public entry points: `from_source`, and `Action.__init__` when called by users.
  Simplest rule: keep it wherever the arrays come from outside ekw.
- Where validation stays, replace pandas `isnull` with a direct scan of the object array
  for `None` and float NaN, e.g. `any(x is None or (type(x) is float and x != x) for x in arr.data.ravel())`,
  or a vectorized `np.frompyfunc` variant. Benchmark both. The intent is only to detect
  missing nodes. `combine_by_coords` with mismatched coords produces NaN fill values.
- Keep the `is_hollow` check. It is cheap.

## 4. `from_source`: fill a numpy array, wrap once

`fluent.py::from_source` writes nodes into an `xr.DataArray` element by element
(`nodes[it.multi_index] = Node(...)`). Each assignment goes through
`DataArray.__setitem__` -> `Variable.__setitem__` -> `as_compatible_data` ->
`_possibly_convert_objects` -> pandas isna, at about 3.6 s of the 4.5 s `from_source`
total in the profile. Fill a plain `np.empty(shape, dtype=object)` instead, then wrap it
in `xr.DataArray(..., dims=dims, coords=coords)` once. `map`/`reduce`/`broadcast`
already do this.

## 5. Optional: `Action.__init__` with `yields`

When `yields` is given, `Action.__init__` uses `xr.apply_ufunc(..., vectorize=True)`
with a Python lambda per node, which creates `Output` objects. This is not hot in the
perf case. Revisit it only if a profile shows it.

## Tests

- `expand_as_qube`: unchanged results for single-child chains, multi-child branching
  (named and unnamed children) and the `dims` filter.
- `transform`: results equal to the current implementation for scalar and Coord `dim`,
  `axis` != 0, `path` subsets, funcs that return actions with and without the dim
  already present, and a single param (squeeze).
- `nodetree_from_dict(validate=True)` still rejects NaN-containing trees built via a
  coord-mismatching `combine_by_coords`.
- Graph equivalence on the perf blueprint: byte-identical `graph2job` output, with
  identical node ordering in the node arrays (coords order matters for downstream selects).

## Expected effect

About 7-10 s today in the perf case. After the per-node specs land, this is the main
remaining cost of `expand_as_qube`, and the quadratic parts (`join`, repeated validation)
matter more for larger fan-outs.

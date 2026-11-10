# Running the MEPS-based checkpoints (AILA, BRIS 2025/10)

This document records what was needed to run the two nested limited-area checkpoints built on the MEPS
2.5 km domain -- `aila-nordic-2.0` (FMI) and `bris-nordic-2025.10` (MET Norway) -- end to end in Forecast-in-a-Box, and
to plot their output.

Status as of 2026-11-09: both checkpoints run from `opendata:ecmwf:highres` and write correct GRIB
output, verified with the `checkpointMatrix` largeE2E scenario (see
[backend/tests/largeE2E/README.md](../../../backend/tests/largeE2E/README.md)). Plotting works through a
workaround in the plot runtime. The changes are to the catalog entries of both checkpoints and to the
plugin. All the packages they use are released versions, and the catalog entries reference no local
wheels or GRIB template files. All of this was done on an NVIDIA GB10 host (aarch64, 121 GB of memory
shared between CPU and GPU).

## The checkpoints

Both models nest a MEPS-derived limited area (LAM) inside a global N320 grid, with 1024 channels and 16
graph-transformer processor layers:

| | `aila-nordic-2.0` | `bris-nordic-2025.10` |
|---|---|---|
| Source | https://sites.ecmwf.int/repository/fiab/fmi/checkpoints/aila-2.0.ckpt | https://sites.ecmwf.int/repository/fiab/metnorway/checkpoints/bris-2025_10.ckpt |
| LAM grid | full MEPS grid, 949 x 1069 = 1,014,481 points | MEPS grid with 50 points trimmed per edge, 849 x 969 = 822,681 points |
| Model grid (LAM + N320) | 1,549,490 points | 1,359,281 points |
| Masks | `lam_0/cutout_mask`, `global/cutout_mask` | `lam_0/cutout_mask`, `global/cutout_mask` |

The MEPS LAM grid is a Lambert conformal conic grid, although the checkpoints only store it as lists of
latitudes and longitudes (`source0/latitudes`, `source0/longitudes`, no projection parameters). It was
identified from the training dataset (`aifs-meps-2.5km-2020-2023-6h-v7.zarr`) and verified: projecting
the stored coordinates with LaD = Latin1 = Latin2 = 63.3 deg, LoV = 15 deg, on a sphere of radius
6,371,000 m gives a regular 2,500 m grid, row-major, to float32 precision. The regrid plugin's named
`meps` grid is identical to AILA's points.

The `aila-nordic-2.0` checkpoint is the same model as FMI's Hugging Face release
(https://huggingface.co/finnish-meteorological-institute/aila, `ailav2.ckpt`): same training run
(`uuid a74f41db-90f9-40ad-95ff-9b9ad9c2e914`) and byte-identical weights and supporting arrays. The
ECMWF-hosted copy only has operational metadata fixes: pressure-level variables with `param` +
`levelist`/`levtype`, `z`/`lsm` marked `constant_in_time`, and no pickled reference to
`anemoi.training`.

## Changes needed

### 1. Catalog entries

Changes to the `aila-nordic-2.0` and `bris-nordic-2025.10` entries of the artifact catalog:

| Change | `aila-nordic-2.0` | `bris-nordic-2025.10` | Reason |
|---|---|---|---|
| Region names match the checkpoint masks | `lam_0` | `source0` -> `lam_0`, including `region_of_interest` | anemoi-inference loads the mask `<region>/cutout_mask` |
| anemoi-graphs pin | `0.8.5` kept | `anemoi-graphs==0.6.6` dropped | 0.6.6 requires numpy<2, which downgrades the worker environment so that it cannot unpickle task outputs written with numpy 2; the BRIS model does not import anemoi.graphs |
| Released anemoi plugins, MIR and ecCodes pins | added | added | see sections 2 and 3 |
| `ANEMOI_INFERENCE_NUM_CHUNKS` in `control_options` | 16 -> 64 | 16 | bounds the inference memory peak; only applied since fix (c) in section 2 |
| `ECCODES_ECKIT_GEO: "0"` in `control_options` | added | added | Lambert output fails to write otherwise, see section 5 |
| `runner_options.output_templates` and `runner_options.output_modifiers` | MEPS Lambert grid, 949 x 1069 | MEPS Lambert grid, 849 x 969 | GRIB output on the Lambert grid, see section 4 |

`runner_options` is a configuration field added to `AnemoiCheckpointConfiguration` in fiab-core; its
keys are passed through to the anemoi-inference run configuration.

### 2. Upstream packages

The two anemoi plugins are the released versions, pinned in the `pip_package_constraints` of both
catalog entries:

| Package | Version | Contains |
|---|---|---|
| anemoi-plugins-ecmwf-transform | `0.3.1` | (a) a grid given as a dict of latitudes/longitudes is passed to MIR as a `mir.Grid`. Up to 0.2.0 the dict was turned into a string, which MIR silently ignores, so the `regrid` to `checkpoint:source0` returned the N320 input unchanged and the cutout mask did not fit. |
| anemoi-plugins-ecmwf-inference | `0.8.0` | (b) `RegridPreprocessor` sets the state coordinates from the target coordinate lists: MIR writes such grids as `unstructured_grid` GRIB, which carries no coordinates. |

Fixes (a) and (b) were regressions from moving the regrid into anemoi-plugins-ecmwf-transform, and were
first carried as patched wheels (`0.2.0+fiab1`, `0.7.0+fiab1`).

earthkit-workflows-anemoi is not pinned by the catalog entries: fiab-plugin-ecmwf requires
`earthkit-workflows-anemoi>=0.10.3`, the backend pins it in `uv.lock`, and the plugin adds
`earthkit-workflows-anemoi==<version of the backend>` to every worker environment. The fixes these
checkpoints need were first carried as patched wheels (`0.9.0+fiab4`, `0.10.1+fiab1`) and are released:

| Release | Contains |
|---|---|
| `0.10.0` | (c) `CascadeRunner` applies the configuration `env` (the catalog `control_options`) to `os.environ`, as `RunConfiguration.load` does; it builds its `RunConfiguration` directly, so the `env` was never applied, for any checkpoint. This also explains why AILA first ran out of memory: its mappers ran unchunked. |
| `0.10.2` | (d) `CascadeRunner` accepts `output_templates` and `output_modifiers`, passed to the GRIB output as template providers (tried before the default `mir` and `builtin` ones) and GRIB modifiers. Before, it always built its output as plain `cascade`, so a catalog entry could not configure the GRIB encoding. (e) The initial states passed between tasks no longer carry `_input` and `_variables`, which hold the input objects with their filters (such as the regrid preprocessor), as anemoi-inference does for its parallel output. |
| `0.10.3` | The initial-condition request of a wave field stays in the wave streams (`wave`, `waef`). 0.10.2 moved every request to `stream=oper` or `enfo`, so checkpoints with wave inputs, such as AIFS Single, found no initial conditions in open data. Not needed by AILA and BRIS. |

0.10.0 also changed the meaning of `ensemble_members`: `None` is a deterministic run, from the control
forecast (`stream=oper`, `type=fc`), and an integer is a single member id, so the former `ensemble_members=1`
fetches the initial conditions of ENS member 1 (`stream=enfo`, `type=pf`). The plugin passes `None` for
checkpoints that are not marked as ensemble models (`is_ensemble_model`), and the selected members, or the
control member 0, for ensemble models. Their GRIB output is then `type=fc`, `stream=oper`, without a
`number`.

### 3. Dependency pins

`mir-python==1.30.1.30` and `mirlib==1.30.1.30`, with the ecCodes libraries of the same build:
`eccodes==2.49.0`, `eccodeslib==2.49.0.30`, `eckitlib==2.3.0.30`, `atlaslib-ecmwf==0.46.0.30`.
 - anemoi-plugins-ecmwf-transform 0.3 builds the target grid as `mir.Grid(latitudes=..., longitudes=...)`.
   MIR 1.28 rejects it (`SpecError: [Grid: cannot build grid without 'type']`); MIR 1.29.0 to 1.30.2
   regrid such grids correctly, checked up to 100,000 points. The segfault of mir-python 1.30.2.33 on
   unstructured grids of more than a few hundred points only happens on the former route, where the
   coordinate dict is passed to `mir.Job`.
 - The ecCodes pins keep every task of a run on the libraries MIR is built with. mirlib pins its
   ecCodes, eckit and atlas libraries exactly, so a newer eckitlib already loaded by a worker (for example
   eckitlib 2.5.0.34, released before a matching mirlib) makes the environment install fail.

### 4. Lambert output grid

The LAM output is written on the MEPS Lambert grid (grid definition template 3.30, `shapeOfTheEarth=1`
with a radius of 6,371,000 m). The forecast values are written unchanged; nothing is interpolated. The
grid is set from the catalog entry, without a template file:
 - `runner_options.output_templates` is the `builtin` template provider with its index given inline: the
   O96 pressure-level template of anemoi-inference for `levtype: pl`, and its O96 surface template for
   all other variables, both as base64 GRIB2 messages copied from anemoi-inference's `builtin.yaml`.
   These templates carry the ECMWF local section, without which the encoder cannot set `class`, `type`,
   `stream` and `expver`.
 - `runner_options.output_modifiers` is a `patches` modifier setting the grid keys on every variable
   (`".*"`): `gridType: lambert` first, with which ecCodes converts the reduced Gaussian template and
   drops its `pl` array (setting only `gridDefinitionTemplateNumber` keeps the array and corrupts the
   message), then `gridDefinitionTemplateNumber: 30`, the Earth shape and radius, `Nx`, `Ny`, the first grid point, `LaDInDegrees`, `LoVInDegrees`,
   `Latin1InDegrees`, `Latin2InDegrees`, `DxInMetres`, `DyInMetres`, `projectionCentreFlag: 0`,
   `scanningMode: 64` and `resolutionAndComponentFlags: 48`, and `tablesVersion: 36`.

The grid keys correspond to these proj definitions:

| | `aila-nordic-2.0` | `bris-nordic-2025.10` |
|---|---|---|
| proj | `+proj=lcc +lat_0=63.3 +lon_0=15 +lat_1=63.3 +lat_2=63.3 +R=6371000 +units=m +no_defs` | same |
| Nx x Ny, Dx = Dy | 949 x 1069, 2,500 m | 849 x 969, 2,500 m |
| First grid point | 50.319618 N, 0.278281 E (x -1,060,083.933 m, y -1,332,517.699 m) | 51.633816 N, 1.60491 E (x -935,084.016 m, y -1,207,517.776 m) |

The coordinates ecCodes computes from these keys match proj to about 1e-13 deg. `tablesVersion: 36` is the
latest GRIB2 master tables version known to ecCodes 2.46 (newer versions know 37); some parameter
mappings depend on it (a 6 h maximum 10 m gust is `10fg` with tables version 4, and `max_i10fg` with 37).

Both providers are needed because of how the defaults work. The `mir` template provider regrids a base
message to the grid of the input fields: a cropped standard grid, as used by bris-africa-1.0 (O1280 with
an area), stays a `reduced_gg` grid, while a list of coordinates, as produced by the regrid to
`checkpoint:source0`, only gives `unstructured_grid`, without coordinates. Setting the Lambert keys on the
`mir` templates gives the right grid, but builds every template with a MIR regrid to the model's
coordinates, on one CPU core: AILA's GRIB output took more than 25 minutes.

Regridding the input straight to a MIR Lambert grid (`gridType=lambert;...` with the keys `LaDInDegrees`,
`LoVInDegrees`, `Ni`, `Nj`, `grid`, `latitudeOfFirstGridPointInDegrees` and
`longitudeOfFirstGridPointInDegrees`) does not work as a replacement: MIR 1.28 and 1.30 ignore the Earth
shape keys for Lambert grids and always use a radius of 6,371,229 m, which moves the points by up to
0.0035 deg (about 200 m) from the model grid. MIR also loses the southern hemisphere: a cone with a
negative `LaDInDegrees` is written with `LaDInDegrees=0` and a first point in the northern hemisphere.

### 5. `ECCODES_ECKIT_GEO`

Importing the regrid module of anemoi-plugins-ecmwf-transform 0.3 runs
`os.environ.setdefault("ECCODES_ECKIT_GEO", "1")`. With it set, earthkit-data reads the geography of GRIB
fields through the ecCodes `gridSpec` key, which ecCodes 2.48 and later build with eckit::geo. eckit::geo
has no Lambert grid ("Factory(grid) has no builder for lambert"), so reading the geography of the Lambert
output fails with `GeocalculusError: Problem with calculation of geographic attributes`, in the
`write_grib` task. Without the variable, `gridSpec` is missing and earthkit-data computes the Lambert
geography itself. ecCodes 2.46, bundled with MIR 1.28, is not affected.

earthkit-data decides once per process, at the first geography access, whether to use `gridSpec`
(`GRID_SUPPORT.has_ecc_grid_spec` is a cached property). Whether `write_grib` fails therefore depends on
the order of the tasks in a worker: AILA failed on every run, where the worker ran the input, model and
`write_grib` tasks in a row, while BRIS passed, where a plot task read a field's geography first.

`ECCODES_ECKIT_GEO: "0"` in `control_options` is applied by `CascadeRunner` before the regrid preprocessor
is created, so the `setdefault` keeps it. The regrid to the checkpoint coordinates gives identical results
with it.

### 6. Environment on the GB10 host

GPU memory on the GB10 is shared with system memory and is not limited by cgroups (`MemoryMax`): a run
needing more GPU memory than the machine has exhausts the whole machine rather than failing with a CUDA
out-of-memory error. This happened with AILA while `ANEMOI_INFERENCE_NUM_CHUNKS` was not applied (see
fix (c) in section 2); with the chunking applied, both checkpoints run without a memory cap. A cap such as
`PYTORCH_CUDA_ALLOC_CONF=per_process_memory_fraction:0.55` is not set: it limits a run to a fraction of
any GPU, which only costs memory on hosts with a dedicated GPU, and torch 2.9 and older reject the option
(`Unrecognized CachingAllocator option`), which other checkpoints pin.

Set in the environment of the backend on that host (here in the `dev` recipe of the justfile used to
launch it):
 - `UV_EXTRA_INDEX_URL` with the PyTorch `cu130` and `cu129` indexes, and `UV_INDEX_STRATEGY=unsafe-best-match`
   -- PyPI only has CPU builds of torch for aarch64; `cu130` has CUDA builds of torch 2.9 and later, `cu129`
   of torch 2.8, whose `sm_120` kernels run on the GB10 (compute capability 12.1). The `cu126` builds of
   older versions have no kernels for it ("no kernel image is available").
 - `EARTHKIT_DATA_CACHE_POLICY=user` -- the earthkit-data used by the workers defaults to the `off` cache
   policy, which downloads input data into a new temporary directory for every run. With the `user`
   policy, a BRIS run following an AILA run took 3 min 48 s instead of about 12 min.

### 7. Tests

`backend/tests/largeE2E/case_checkpointMatrix.py` lists both checkpoints, and gained a per-checkpoint
`plot` flag, to run a checkpoint without the plot block. `case_sourceMatrix.py` runs the demo
checkpoints against a list of input sources.

### Results

| | `aila-nordic-2.0` | `bris-nordic-2025.10` |
|---|---|---|
| Parameters written | 15 | 21 |
| GRIB grid | `lambert`, 949 x 1069, R = 6,371,000 m | `lambert`, 849 x 969, R = 6,371,000 m |
| Decoded coordinates vs checkpoint | within 5.5e-6 deg | within 4.7e-6 deg |
| Values (step 6) | 2t 269-288 K, msl 990-1032 hPa, tp 0-11 mm | 2t 271-287 K, msl 990-1030 hPa, tp 0-7.4 mm |
| Plots (2t, msl, tp at steps 6 and 12) | 6 | 6 |
| Run time, with input data in the earthkit-data cache (2026-10-30) | 4 min 31 s | 3 min 15 s |
| `checkpointMatrix` total, memory-capped backend (2026-11-06) | 9 min 31 s (input 167 s, model 101 s) | 8 min 34 s (input 145 s, model 47 s) |
| `checkpointMatrix` total, earthkit-workflows-anemoi 0.10.3 (2026-11-09) | 5 min 32 s (input 167 s, model 100 s) | 4 min 9 s (input 142 s, model 47 s) |

## Plotting

Plotting the Lambert output as is fails with `to_points(): geographical coordinates in original CRS
are not available`. Two gaps in earthkit combine:

1. earthkit-data does not implement `to_points()` for `lambert` GRIB fields, although `to_latlon()` and
   `projection()` (`+proj=lcc ... +R=6371000`) work. It raises a `ValueError`.
2. earthkit-plots 0.6.1 calls `to_points()` first and only falls back to `to_latlon()` on
   `AttributeError` or `NotImplementedError`, so the `ValueError` aborts the plot. Its fallback would
   not help either: it passes longitudes and latitudes as if they were x/y in the field's projection, and
   the map collapses to a few metres around the projection origin.

### Workaround in the plot runtime

`map_plot` in `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/plotting/runtime.py` already
rewraps reduced Gaussian sub-area fields (e.g. bris-africa-1.0 output), which earthkit-plots<1.0 cannot
plot either: `_prepare_fields` turns them into `ArrayField`s carrying explicit latitudes and longitudes
and no grid definition, which earthkit-plots plots as scattered lat/lon points. Lambert fields are now
rewrapped the same way (`_is_lambert`, combined with the existing check in `_needs_latlon`). For a
1,014,481-point AILA field the rewrapped plot covers the MEPS domain correctly, and takes about 6 s and
1 GB in the plot environment. Contouring scattered points goes through a triangulation, whose long thin
triangles along the domain boundary draw spurious straight contour segments near the edges of the
domain, as for the reduced Gaussian case; plotting the Lambert grid natively avoids them.

The unit tests (`tests/unit/test_plotting_runtime.py` in fiab-plugin-ecmwf) check which fields are
rewrapped without building the rewrapped `ArrayField`s: with the backend's earthkit-data (0.19.1), a
process holding such a field crashes at interpreter exit (also for the existing reduced Gaussian case),
which fails the test run although the tests pass. The plot environment, with earthkit-data 0.20.0, is not
affected.

### Proper fix

Returning x/y in the projection from `to_points()` is enough for earthkit-plots to plot Lambert fields
natively: computing them with pyproj from `projection()` and `to_latlon()` produces a correctly
georeferenced map. Once earthkit-data implements `to_points()` for Lambert grids and the plot environment
(`PLOT_ENVIRONMENT` in the fiab-plugin-ecmwf plotting blocks) uses that release, the Lambert case of the
workaround can be removed.

## What is left

 - Upstream reports to file:
   - anemoi-plugins-ecmwf-transform: setting `ECCODES_ECKIT_GEO` for the whole process on import,
   - eckit::geo: no Lambert conformal grid, which makes `gridSpec` fail with ecCodes 2.48 and later,
   - earthkit-data: `to_points()` for Lambert grids,
   - MIR: the 1.30 segfault on unstructured grids passed to `mir.Job`, the Earth shape keys being ignored
     for Lambert grids, and southern hemisphere Lambert grids.

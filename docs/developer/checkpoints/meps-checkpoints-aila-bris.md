# Running the MEPS-based checkpoints (AILA, BRIS 2025/10)

This document records what was needed to run the two nested limited-area checkpoints built on the MEPS
2.5 km domain -- `aila-v2` (FMI) and `BRIS-2025.10` (MET Norway) -- end to end in Forecast-in-a-Box, and
to plot their output.

Status as of 2026-10-30: both checkpoints run from `opendata:ecmwf:highres` and write correct GRIB
output, verified with the `checkpointMatrix` largeE2E scenario (see
[backend/tests/largeE2E/README.md](../../../backend/tests/largeE2E/README.md)). Plotting works through a
workaround in the plot runtime. The changes are to the catalog entries of both checkpoints, to patched
builds of upstream packages they reference, and to the plugin. All of this was done on an NVIDIA GB10
host (aarch64, 121 GB of memory shared between CPU and GPU).

## The checkpoints

Both models nest a MEPS-derived limited area (LAM) inside a global N320 grid, with 1024 channels and 16
graph-transformer processor layers:

| | `aila-v2` | `BRIS-2025.10` |
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

The `aila-v2` checkpoint is the same model as FMI's Hugging Face release
(https://huggingface.co/finnish-meteorological-institute/aila, `ailav2.ckpt`): same training run
(`uuid a74f41db-90f9-40ad-95ff-9b9ad9c2e914`) and byte-identical weights and supporting arrays. The
ECMWF-hosted copy only has operational metadata fixes: pressure-level variables with `param` +
`levelist`/`levtype`, `z`/`lsm` marked `constant_in_time`, and no pickled reference to
`anemoi.training`.

## Changes needed

### 1. Catalog entries

Changes to the `aila-v2` and `BRIS-2025.10` entries of the artifact catalog:

| Change | `aila-v2` | `BRIS-2025.10` | Reason |
|---|---|---|---|
| Region names match the checkpoint masks | `lam_0` | `source0` -> `lam_0`, including `region_of_interest` | anemoi-inference loads the mask `<region>/cutout_mask` |
| anemoi-graphs pin | `0.8.5` kept | `anemoi-graphs==0.6.6` dropped | 0.6.6 requires numpy<2, which downgrades the worker environment so that it cannot unpickle task outputs written with numpy 2; the BRIS model does not import anemoi.graphs |
| Patched wheels and MIR pin | added | added | see sections 2 and 3 |
| `ANEMOI_INFERENCE_NUM_CHUNKS` | 16 -> 64 | 16 | bounds the inference memory peak; only effective with patch 2c |
| `runner_options.output_templates` | Lambert template, 949 x 1069 | Lambert template, 849 x 969 | GRIB output with coordinates, see section 4 |

`runner_options` is a configuration field added to `AnemoiCheckpointConfiguration` in fiab-core; its
keys are passed through to the anemoi-inference run configuration.

### 2. Patched upstream packages

Patched wheels with a `+fiab` version suffix, referenced from the `pip_package_constraints` of both
catalog entries:

| Package | Wheel | Fix |
|---|---|---|
| anemoi-plugins-ecmwf-transform | `0.2.0+fiab1` | (a) `normalise_grid` passes a grid given as a dict of latitudes/longitudes to MIR unchanged. It turned the dict into a string, which MIR silently ignores, so the `regrid` to `checkpoint:source0` returned the N320 input unchanged and the cutout mask did not fit. Repr and log messages summarise coordinate grids by their size. |
| anemoi-plugins-ecmwf-inference | `0.7.0+fiab1` | (b) `RegridPreprocessor` sets the state coordinates from the target coordinate lists: MIR writes such grids as `unstructured_grid` GRIB, which carries no coordinates. |
| earthkit-workflows-anemoi | `0.9.0+fiab2` | (c) `CascadeRunner` applies the configuration `env` to `os.environ`, as `RunConfiguration.load` does; it builds its `RunConfiguration` directly, so the `env` (the catalog `control_options`) was never applied, for any checkpoint. (d) `CascadeRunner` accepts `output_templates`, GRIB template providers tried before the default `mir` and `builtin` ones. |

Fixes (a) and (b) are regressions from moving the regrid into anemoi-plugins-ecmwf-transform: up to
anemoi-plugins-ecmwf-inference 0.5.0 the coordinate dict was passed to `mir.Job` directly. Both are still
present on `main` of https://github.com/ecmwf/anemoi-plugins-ecmwf. Fix (c) also explains why AILA first
ran out of memory: its mappers ran unchunked.

### 3. Dependency pin

`mir-python==1.28.1.19` and `mirlib==1.28.1.19`: mir-python 1.30.2.33 segfaults when regridding to an
unstructured grid of more than a few hundred points (500 points work, 1,000 crash).

### 4. Lambert output templates

The LAM output is written onto a GRIB template on the MEPS Lambert grid, built with ecCodes (grid
definition template 3.30, `shapeOfTheEarth=1` with a radius of 6,371,000 m), one per checkpoint. The
forecast values are written onto it unchanged; nothing is interpolated. The templates need:
 - an ECMWF local section (`setLocalDefinition=1`, `localDefinitionNumber=1`), without which the encoder
   cannot set `class`, `type`, `stream` and `expver`,
 - a surface base field without a fixed height (`paramId=134`); a 2 m temperature base field leaked
   `level=2` into every surface field whose parameter does not define its own level, such as `msl` and
   `tp`.

How the default output templates work explains why this is needed for these two checkpoints only. The
`mir` template provider regrids a base message to the `grid`/`area` found in the input fields' GRIB
geography. A cropped standard grid, as used by graceful-gazelle (O1280 with an area), stays a
`reduced_gg` grid; a list of coordinates, as produced by the regrid to `checkpoint:source0`, only gives
`unstructured_grid`, without coordinates.

Regridding the input straight to a MIR Lambert grid (`gridType=lambert;...` with the keys `LaDInDegrees`,
`LoVInDegrees`, `Ni`, `Nj`, `grid`, `latitudeOfFirstGridPointInDegrees` and
`longitudeOfFirstGridPointInDegrees`) does not work as a replacement: MIR 1.28 and 1.30 ignore the Earth
shape keys for Lambert grids and always use a radius of 6,371,229 m, which moves the points by up to
0.0035 deg (about 200 m) from the model grid.

### 5. Environment on the GB10 host

GPU memory on the GB10 is shared with system memory and is not limited by cgroups (`MemoryMax`): a run
needing more GPU memory than the machine has exhausts the whole machine rather than failing with a CUDA
out-of-memory error. This happened with AILA while `ANEMOI_INFERENCE_NUM_CHUNKS` was not applied (see
patch 2c); with the chunking applied, both checkpoints run without a memory cap. A cap such as
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

### 6. Tests

`backend/tests/largeE2E/case_checkpointMatrix.py` lists both checkpoints, and gained a per-checkpoint
`plot` flag, to run a checkpoint without the plot block. `case_sourceMatrix.py` runs the demo
checkpoints against a list of input sources.

### Results

| | `aila-v2` | `BRIS-2025.10` |
|---|---|---|
| Parameters written | 15 | 21 |
| GRIB grid | `lambert`, 949 x 1069, R = 6,371,000 m | `lambert`, 849 x 969, R = 6,371,000 m |
| Decoded coordinates vs checkpoint | within 5.5e-6 deg | within 4.7e-6 deg |
| Values (step 6) | 2t 269-288 K, msl 990-1032 hPa, tp 0-11 mm | 2t 271-287 K, msl 990-1030 hPa, tp 0-7.4 mm |
| Plots (2t, msl, tp at steps 6 and 12) | 6 | 6 |
| Run time, with input data in the earthkit-data cache | 4 min 31 s | 3 min 15 s |

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
rewraps reduced Gaussian sub-area fields (e.g. graceful-gazelle output), which earthkit-plots<1.0 cannot
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

 - The catalog entries reference the patched wheels and the Lambert template files by path, so these
   files must be available wherever the backend runs. The catalog has no way to ship a template file
   with an entry; the wheels can be dropped once the upstream fixes are released.
 - Upstream reports to file:
   - anemoi-plugins-ecmwf: fixes (a) and (b),
   - earthkit-workflows-anemoi: fixes (c) and (d),
   - earthkit-data: `to_points()` for Lambert grids,
   - MIR: the 1.30 segfault on unstructured grids, and the Earth shape keys being ignored for Lambert
     grids.

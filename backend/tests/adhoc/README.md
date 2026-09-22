# Adhoc plugin-install scenarios

This folder is **not** part of `backend/tests/unit` or `backend/tests/integration`, and is not
wired into `just val`. It exists to give
`forecastbox.domain.plugin.compatibility.install_plugin_compatibly` real, end-to-end coverage
against an actual `uv` binary and a real (if tiny and disposable) set of installed distributions,
complementing the mocked unit tests in `backend/tests/unit/domain/plugins/test_compatibility.py`
and `backend/tests/unit/utility/test_packages.py`.

It implements the following scenarios:
1. A plugin with a new dependency installs successfully without changing existing packages.
2. A plugin requiring a different version of an existing package fails during dry-run and leaves
   that package unchanged.
3. Updating the selected plugin is allowed while another installed plugin remains pinned.
4. An editable/local protected package is preserved and is not replaced from an index.
5. An editable/local selected plugin can be updated.
6. A successful real installation passes `uv pip check` and can be imported after cache
   invalidation.
7. A freshly editable-installed plugin becomes importable in the *same* interpreter process that
   performed the install, without a restart -- exercising `forecastbox.utility.pth_activation`
   directly (not `install_plugin_compatibly`, since that module's other dependencies, e.g. `git`,
   are not installed in the scratch venv; `pth_activation` has none beyond the standard library).

## Running

```bash
cd backend/tests/adhoc
just val
```

or directly:

```bash
uv run python backend/tests/adhoc/run_scenarios.py
```

`uv run` is used so the script itself reuses the backend project's default virtual environment
(for `forecastbox`, `packaging`, etc.) -- but see "Isolation" below for where the *plugins under
test* actually get installed.

## Isolation

The scenarios do **not** install anything into the backend project's default/shared virtual
environment. Instead, `run_scenarios.py` creates a throwaway `uv`-managed virtual environment in a
temp directory, builds all `fiab-adhoctest-*` packages under `packages/` into a local wheelhouse,
and points every `uv` invocation at that temp venv and wheelhouse via `--python`, `UV_FIND_LINKS`
and `UV_OFFLINE=1`. This keeps the test hermetic (no PyPI access, ever), reproducible (a clean
`uv pip check` baseline every run), and safe to run repeatedly without accumulating cruft or
interfering with a shared development environment.

If you ever do need to point this at a real, persistent virtual environment, all packages here
are named `fiab-adhoctest-<name>` specifically so leftovers are unambiguous and easy to spot/purge.

## Packages

All packages under `packages/` are minimal `setuptools`-backed distributions (a `pyproject.toml`
and a one-line `__init__.py`), built offline with `uv build` -- no compiled extensions, no
PyPI-hosted build dependencies beyond `setuptools` (already present in `uv`'s cache from normal
development use). None of them depend on anything besides `fiab-core` and, where relevant, one
other adhoc package (e.g. `fiab-adhoctest-plugin-beta` depends on `fiab-adhoctest-widget`):

* `pseudonumpy_v1` / `pseudonumpy_v2` -- `fiab-adhoctest-pseudonumpy` at `1.0.0`/`2.0.0`, no deps.
  Stands in for "some existing dependency" that must stay pinned; `plugin_gamma` requests the
  conflicting `2.0.0`.
* `widget` -- `fiab-adhoctest-widget` at `1.0.0`, no deps. A genuinely new dependency introduced by
  `plugin_beta`.
* `plugin_alpha_v1` / `plugin_alpha_v2` -- `fiab-adhoctest-plugin-alpha`, depends on `fiab-core`
  only. `v1` is installed editable (`-e <path>`) as the seeded baseline; `v2` is built to a wheel
  and installed via a direct `file://` reference to exercise updating a local/editable plugin.
* `plugin_beta` -- depends on `fiab-core` and `fiab-adhoctest-widget==1.0.0`; installed via a plain
  `name==version` requirement resolved against the local wheelhouse (`--find-links`), i.e. "as if
  it was a registry".
* `plugin_gamma` -- depends on `fiab-core` and `fiab-adhoctest-pseudonumpy==2.0.0`, deliberately
  conflicting with the pinned `1.0.0` already installed.
* `plugin_delta_v1` / `plugin_delta_v2` -- `fiab-adhoctest-plugin-delta` at `1.0.0`/`1.1.0`,
  depends on `fiab-core` only. `v1` is the seeded baseline; `v2` is the requested update.
* `plugin_epsilon` -- `fiab-adhoctest-plugin-epsilon` at `1.0.0`, no deps. Unlike every other
  package here, it is never pre-built into the wheelhouse or pre-seeded into the scratch venv:
  scenario 7 performs its editable install itself (via a nested subprocess running under the
  scratch venv's own interpreter), so it can observe the environment both before and after.

`fiab-core` itself is built from `backend/packages/fiab-core` into the same wheelhouse, so the
scratch environment never needs any package from outside this repository.

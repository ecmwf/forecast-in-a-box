# scripts/cicd

Shell helpers consumed by `.github/workflows/`. All scripts are bash.

## Structure

- `scripts.sh` -- pure bash functions, no side effects at source time. Sourced
  by workflows via `source scripts/cicd/scripts.sh`. Add new reusable logic here.
- `prepareBuildVenv.sh`, `prepareValVenv.sh`, `tearDownVenv.sh` -- standalone
  sourced scripts that create/destroy uv virtual environments. They must be
  sourced (not executed) because they export environment variables into the
  caller's shell. `prepareBuildVenv.sh` also sets `SCRIPT_DIR`; the val and
  teardown scripts rely on it being present.
- `test_scripts.sh` -- the test suite. Run with `just val-cicd-scripts`.
- `test_mocks/` -- mock executables (`git`, `twine`, `uv`) prepended to PATH
  during tests. Each mock records every call to `$MOCK_CALLS_FILE` and returns
  data controlled by `MOCK_*` environment variables (see each mock for details).

## Design principles

- Functions in `scripts.sh` must be pure (no side effects when the file is
  sourced). Side effects happen only when a function is called.
- Sourceable scripts (`prepare*.sh`, `tearDown*.sh`) are thin wrappers that do
  exactly one thing (set up or tear down a venv). Keep them minimal.
- Mocks shadow real tools via PATH; they never call real network or disk
  operations.
- Tests never require real git repos, PyPI access, or Python environments.

## How to add a function

1. Add it to `scripts.sh` with a comment block explaining args and behaviour.
2. Add a `test_<function_name>()` block in `test_scripts.sh` using the existing
   assertion helpers (`assert_eq`, `assert_contains`, `assert_fails`, etc.).
3. Call the new test function in the "Run all tests" section at the bottom of
   `test_scripts.sh`.
4. Run `just val-cicd-scripts` and confirm all tests pass.

## How to add a sourceable script

Source it in a subshell inside the test function -- `cd` to a temp directory
first so relative venv paths work, export `MOCK_CALLS_FILE` and prepend
`$MOCKS_DIR` to PATH, then capture env var output via `printf`. The uv mock
creates a working fake activate script automatically when `uv venv <dir>` is
called, so no additional setup is needed. See `test_prepare_build_venv` for a
worked example.

## Caveats

- `git tag -l <pattern>` in the mock returns `$MOCK_GIT_TAGS_LIST` verbatim
  without filtering. Set the variable to only the tags that the real git would
  return for the given pattern.
- `set -uo pipefail` is active in the test runner. Sourceable scripts under
  test inherit it; guard against unbound variables accordingly.
- `tearDownVenv.sh` calls `deactivate`, which is a shell function defined by
  `activate`. When testing, define a mock `deactivate` function before sourcing
  the teardown script and unset it afterwards.

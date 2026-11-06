# CI/CD

Workflows are defined in [`.github/workflows/`](../../.github/workflows/). The `ci` workflow runs on pushes to `main` and pull requests that touch its configured paths (`backend/`, `frontend/`, `cli/`, `.github/`, `scripts/cicd/` or `install/`), and can also be started manually. The `cd-*` and `bigtest` workflows are started by hand, except `cd-docker`, which also runs when a release is published.

## Workflows

| Workflow | Triggers | What it does |
|---|---|---|
| `ci.yml` | push, pull request, manual | Detects which parts changed, then runs only the matching jobs (below). |
| `cd-core.yml` | manual | Builds and validates `fiab-core` and `fiab-plugin-test`. Runs a release validation when releasing. |
| `cd-plugins.yml` | manual | Builds and tests the demo and ECMWF plugins. |
| `cd-backend.yml` | manual | Runs `just fiabwheel`, which builds the frontend and packages the backend wheel, then runs the tests. |
| `cd-docker.yml` | release, manual | Builds release images for x86 and ARM and pushes them to the registries. |
| `cd-artifacts_update.yml` | manual | Updates the artifact catalogue. |
| `bigtest.yml` | manual | Installs a released backend, starts it, and runs a forecast with a small model on dummy data. |

## Jobs in `ci.yml`

A `changes` job checks which paths were touched. Each job below runs only when its paths changed.

| Job | Runs on | Runs when | What it does |
|---|---|---|---|
| `macos` | Self-hosted macOS, one job per architecture | Backend changed, and the pull request comes from `ecmwf/forecast-in-a-box` or the run was started by hand | Runs `just val`. |
| `ubuntu` | GitHub-hosted Ubuntu | Backend changed | Runs `just val`. |
| `frontend` | GitHub-hosted Ubuntu | Frontend changed | Checks formatting and linting, runs the unit and integration tests, and checks that the build succeeds. Playwright end-to-end tests are not run here. |
| `cli` | Self-hosted macOS ARM64 | CLI changed | Runs the Cargo tests. |
| `CI/CD scripts` | GitHub-hosted Ubuntu | `scripts/cicd` changed | Runs `just val-cicd-scripts`. |

Pull requests from forks do not run the `macos` job, because its condition requires the pull request to target `ecmwf/forecast-in-a-box`.

## Self-hosted runners

Several jobs need self-hosted runners, not GitHub-hosted ones. A fork without those runners will not run those jobs. The jobs that use them are `macos`, `cli`, `bigtest.yml` and the macOS part of `cd-docker.yml`. The `bigtest.yml` workflow runs on a Linux runner labelled `platform-builder-docker-xl`.

## Shell helpers

The scripts that the workflows call live in [`scripts/cicd/`](../../scripts/cicd/). The [README](../../scripts/cicd/README.md) file explains how to add a helper and how its tests work. Run the tests with `just val-cicd-scripts` from the repository root.

## Running the same checks locally

| Check | Command |
|---|---|
| Backend validation | `just val` in `backend/`, or `just val` at the root for all packages. |
| Frontend checks | `npm run check`, then `npm run test:run`, then `npm run build` in `frontend/`. |
| CLI | `cargo test` in `cli/`. |
| CI/CD scripts | `just val-cicd-scripts` at the root. |
| Pre-commit hooks | `uv run prek` at the root. |

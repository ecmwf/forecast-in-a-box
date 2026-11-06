# Backend Development

The backend is the `forecastbox` Python package. It serves the HTTP API and the bundled frontend, and runs forecasts through plugins. It is managed with [uv](https://docs.astral.sh/uv/).
For more information about the project, please see the project [README](../README.md).

## Set up

```bash
cd backend
uv sync --extra runtime --all-packages
```

## Run

From the repository root, run:
```bash
just dev
```
It starts the backend from your checkout with editable installs. More details are given in [launching](../docs/developer/guidelines/launching.md).

## Validate

| Command | What it runs |
|---|---|
| `just val` | Type checking with `ty`, then `just test`. Run this before a commit. |
| `just test` | Unit tests in `tests/unit`, then integration tests in `tests/integration`. |
| `uv run pytest tests/unit -n4` | Quick unit tests while you work. |

`tests/largeE2E` is for releases and is not part of normal work.

## Layout

- `src/forecastbox/`: the application, it is split into `entrypoint`, `routes`, `domain`, `schemata` and `utility`.
- `packages/`: `fiab-core` (the plugin contract), the bundled plugins, and the MCP server.
- `tests/`: unit, integration and release-only end-to-end tests.

## Rules and configuration

- Coding rules, import order, concurrency and compatibility requirements are in [development.md](development.md).
- Configuration keys and where they come from are in [coonfiguration](../docs/tuningAndConfiguration.md#configuration).

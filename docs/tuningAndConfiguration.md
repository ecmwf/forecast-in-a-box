# Useful Recipes and HowTos
## Configuration

Every setting is a field of the `FIABConfig` model in [`backend/src/forecastbox/utility/config.py`](../backend/src/forecastbox/utility/config.py). That file is the reference for all keys and defaults. This section explains where values come from and the main sections.

### Where values come from

Sources are read in this order. The first source that sets a key wins:

1. Environment variables with the prefix `fiab__`. Nested keys are joined with `__`, for example `fiab__backend__uvicorn_port=8080`.
2. Secret files.
3. A `.env` file in the working directory, using the same names as the environment variables.
4. `config.toml` in the FIAB root.

The FIAB root is `$FIAB_ROOT` if it is set. Otherwise it is `~/.fiab`. `fiab.sh` uses `~/.fiab` by default. `just dev` sets `FIAB_ROOT=.fiab` inside `backend/`, so its config file is `backend/.fiab/config.toml`. If `config.toml` is missing, `just dev` copies in [example_dev_config.toml](developer/guidelines/example_dev_config.toml).

```toml
[backend]
uvicorn_port = 8080
launch_browser = false
```

### Main sections

| Section | Controls | Notes |
|---|---|---|
| `backend` | The HTTP server, scheduler, concurrency and browser launch. | `uvicorn_host` defaults to `0.0.0.0`, so the server listens on all interfaces. `uvicorn_port` defaults to `8000`. `launch_browser` defaults to `true`. |
| `auth` | Authentication: passthrough mode, the JWT secret, OIDC login, public URL and domain allowlist. | `passthrough` defaults to `true`, which bypasses authentication and grants unauthenticated requests an admin context. For any shared installation, set `passthrough = false` and replace the placeholder `jwt_secret` with your own secret. |
| `db` | Paths of the users and jobs SQLite databases. | Both default to files in the FIAB root. |
| `external` | Default plugins, plugin stores, artifact stores and the model repository. | Stores and default plugin IDs are described in [Plugins (basic)](operator/plugins.md). |
| `cascade` | The gateway that runs jobs, and its host and worker limits. | Defaults run everything on the local machine. |
| `product` | Settings used by products, such as the pproc schema directory and the default input source. | |



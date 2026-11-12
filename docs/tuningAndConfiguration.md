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
| `external` | Default plugins, plugin stores, artifact stores and the model repository. | Stores and default plugin IDs are described in [Plugins (Operator)](operator/plugins.md). |
| `cascade` | The gateway that runs jobs, and its host and worker limits. | Defaults run everything on the local machine. |
| `product` | Settings used by products, such as the pproc schema directory and the default input source. | |

### Environment variables outside the config model

| Variable | Read by | Purpose |
|---|---|---|
| `FIAB_ROOT` | `fiab.sh`, backend | Overrides the FIAB root directory. |
| `FIAB_PY_VERSION` | `fiab.sh` | Python version to install and use. |
| `FIAB_PIP_EXTRA` | `fiab.sh` | Extra arguments for installing the wheel. |
| `UV_PATH` | `fiab.sh` | Path to the `uv` binary to use. |
| `FIAB_LOGSTDOUT` | backend | Set to `yea` to write logs to standard output instead of log files. |
| `FIAB_IGNORE_CONFIG_SOURCES` | tests | Set to `1` to ignore `.env` and `config.toml`. The test recipes set it. |

Run `bash ./fiab.sh help` for the launcher's full list of commands.

## How to get logs
Often you get `TaskFailure(detail="something went wrong but there are no details", worker="h0.w1")` in the logs, but not the stack trace itself.
This is because executor logs don't go to the stdout generally -- only the fiab server logs end up there.
To get the full stacktrace and full history, you can either:
1. call the logs endpoint, `api/v1/gateway/logs`, which will return you a zip file with all the log files (this is useful for pair debugging),
2. pick the logs from the file system -- the gateway logs at the start a line like `logging base is at {Globals.logs_directory.name}` which tells you where the folder with all logs is located (most likely something like `/tmp/fiabLogs<something>`, you can also just ls and pick by date),
3. export `FIAB_LOGSTDOUT=yea` before you start your fiab process -- then you will not get logging into the files, but everything will be in the standout.

Note: A large amount of logs may be produced, which may hinder option 3. The file-based logging separates logs from controller, gateway, executors, etc. In this example we would find the stacktrace in the file with `h0.w1` in name, though in some cases logs of the controller or other workers may be relevant as well.

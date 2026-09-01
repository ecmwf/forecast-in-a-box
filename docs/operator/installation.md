You may want to consult the [c4 diagrams](./c4diagrams.md) to give you a better picture.

After you are done with installation, you may want to visit [tuning and configuration](tuningAndConfiguration.md) as well.

# Standalone Setup

The recommended way to run Forecast-in-a-Box is via the self-bootstrapping launcher:

```bash
curl -LsSf https://raw.githubusercontent.com/ecmwf/forecast-in-a-box/main/scripts/fiab.sh > fiab.sh
chmod +x fiab.sh
./fiab.sh
```

This handles uv, Python, dependencies, and launches both the backend and cascade automatically.

## Preparing the environment ahead of time

If you want to prepare a machine without launching the application -- for example to have everything
downloaded and installed before a demo, or when provisioning an image -- run the launcher in the
warmup mode:

```bash
./fiab.sh warmup
```

This creates the virtual environment and installs the default plugin into it. To install a different
set of plugins, pass their composite ids (`store:plugin`) with `-p`, comma-separated:

```bash
./fiab.sh warmup -p ecmwf:ecmwf-base,mystore:myplugin
```

The warmup expects to run in isolation -- do not run it while a backend is running, as both mutate
the same virtual environment, configuration file and database. Once a warmup has been executed, a
subsequent regular launch does not attempt any plugin installation on its own.

# Containerized Setup
Consult the docker examples:
1. [slim](../../deployment/v2) -- just "run fiab.sh warmup in a Dockerfile" which is sufficient for a demonstration,
2. [ewc](../../deployment/ewc) -- a more involved setup, though may be a bit out of date.

# Developer Setup

See [backend development](../../backend/development.md) and [frontend guidelines](../../frontend/GUIDELINES.md).

```bash
# backend
cd backend
uv sync --extra runtime --all-packages
just dev

# frontend
cd frontend
npm install
npm run dev
```

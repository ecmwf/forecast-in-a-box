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

This creates the virtual environment and installs the default plugins into it. The plugins are
the composite ids (`store:plugin`) listed in `default_plugins` of the `[external]` section of the
`config.toml` in the fiab root directory.

By default, the most recent release is installed. To install a particular one instead, give it
as an argument -- this is only allowed when nothing is installed yet:

```bash
./fiab.sh warmup v1.2.3
```

The warmup expects to run in isolation -- do not run it while a backend is running, as both mutate
the same virtual environment, configuration file and database. Once a warmup has been executed, a
subsequent regular launch does not attempt any plugin installation on its own.

## Upgrading and reinstalling

A regular launch never changes the installed release. To change it, stop the running Forecast-in-a-Box
(or the service), then run either of:

```bash
./fiab.sh upgrade [v1.2.3]   # the most recent release if not given
./fiab.sh reinstall [v1.2.3] # prompts for the current or the most recent release if not given
```

The `upgrade` keeps the database, configuration and artifacts, and only updates the launcher and the
virtual environment. It is currently supported only within the same major version, and never to
a lower version. The `reinstall` deletes the whole fiab root directory (`~/.fiab`) and installs from scratch.
Neither launches Forecast-in-a-Box -- run the launcher again (or restart the service) afterwards.

# Containerized Setup
Consult the docker examples:
1. [slim](../../deployment/v2) -- just "run fiab.sh warmup in a Dockerfile" which is sufficient for a demonstration,
2. [ewc](../../deployment/ewc) -- a more involved setup, though may be a bit out of date.

For a smooth and performant execution of bigger models, a GPU is recommended.
The `slim` image does _not_ come with CUDA pre-installed, however, cooperates well with [NVIDIA Container Toolkit](https://github.com/NVIDIA/nvidia-container-toolkit).
In other words, install the toolkit on the _host_ machine, then run `slim` in any container runtime (docker, compose, containerd, ...) with the GPU resource, and the FIAB in the container recognizes and utilizes the mounted GPU.

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

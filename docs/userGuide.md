# User Guide

Forecast-in-a-Box (FiaB) is a single page application displaying an interactive user interface (UI) connected to a fully packaged AI-driven weather forecasting system.

This displays a step-by-step guide for Operators and Developers deploying FiaB on a laptop or server:
**[Operator]** Researcher or domain expert with low-to-medium technical proficiency
**[Developer]** Active contributer of Forecast-in-a-Box with medium-to-high technical proficiency

For advanced installation instructions, see [Advanced Installation](installation.md).
A FiaB [System Context Diagram](c4diagrams.md) is available for more information.
If you entounter issues during installation, please refer to the [Troubleshooting](troubleshooting.md).

## Operator

Pre-requisites (packages that should already be installed on `$PATH`):
* `bash`
* `curl`
The launcher installs everything else into `~/.fiab`. There is no need to clone the whole FiaB repository.

1. Download the launcher:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/ecmwf/forecast-in-a-box/main/scripts/fiab.sh -o fiab.sh
   ```

2. Start Forecast-in-a-Box. The first run installs the latest release, then opens a browser at `localhost:8000`:

   ```bash
   bash ./fiab.sh
   ```

3. Install plugins from the Plugins screen in the UI (optional).
    For installing, configuring and troubleshooting plugins, see [Plugins (Operator)](operator/plugins.md)
    Note: Do not install plugins into the environment with `pip`. That leaves the database out of sync with the installed packages.

4. Upgrade FiaB from the UI, or the terminal. Stop the application first:

   ```bash
   bash ./fiab.sh upgrade
   ```

   Upgrades stay within the same major version. To start from scratch, run:
   ```bash
   bash ./fiab.sh reinstall
   ```
   This deletes `~/.fiab`
    
    Note: The user interface (browser) has embedded help for building and running FiaB.

## Developer

Pre-requisites (tools are expected to be found in `$PATH`):
* `just` - run project commands
* `uv` - create and manage Python virtual environments
* `npm` - node package manager
* `git` - cloning and contributing to the repository
* `docker` (optional) - build and run FiaB on containers 

1. Clone the repository and go to its root:

   ```bash
   git clone https://github.com/ecmwf/forecast-in-a-box.git
   cd forecast-in-a-box
   ```

2. Start the backend and frontend from the checkout:

   ```bash
   just dev
   ```

   The first run builds the frontend (if missing). It also creates `backend/.fiab/`, copies an example `config.toml` into it, and starts the backend with editable installs. Details can be found in [Launching](developer/guidelines/launching.md).

3. To create a new plugin, add its store to `backend/.fiab/config.toml`:

   ```toml
   [external.plugin_stores.myStore]
   url = "file://./packages/fiab-plugin-myproduct"
   method = "localSingle"
   ```

   Stop the backend and run `just dev` again after saving `config.toml`, then install the plugin from the Plugins screen. Plugin development is covered in [Plugins (Developer)](developer/guidelines/plugins.md).

4. Before committing, run the checks described in [Backend Development](../backend/development.md) and the frontend commands in [Frontend Development](../frontend/README.md). In short, run at the root:
```bash
just val
uv run --project backend prek
```

5. To reset a checkout's state, run:
```bash
just dev reinstall
```
This drops the local database and recreates the environment.

## Summary differences between user profiles

| | Operator | Developer |
|---|---|---|
| Source | Released wheel from PyPI | Git checkout, editable installs |
| Configuration | `~/.fiab/config.toml` | `backend/.fiab/config.toml` |
| Plugins | Installed from the UI | Local store with `file://`, optionally editable |
| Upgrade | `fiab.sh upgrade` or the UI | Pull and restart |
| Reset | `fiab.sh reinstall` | `just dev reinstall` |
| Logs | Log files, or `FIAB_LOGSTDOUT=yea` | Same, plus the logs endpoint for a zipped copy |


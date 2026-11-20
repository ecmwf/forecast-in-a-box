# User Guide

Forecast-in-a-Box (FiaB) is a single page application displaying an interactive user interface (UI) connected to a fully packaged AI-driven weather forecasting system.

This page contains basic instructions for deploying FiaB on a laptop or server, for different user personas:
**[Forecaster]** A forecaster, researcher or domain expert, who does not need to have technical procicency. They run and interact with FiaB through the UI only.
**[Plugin Developer]** A reserarcher/domain expert with some technical proficiency, or a software engineer with some domain knowledge. They develop FiaB plugins (blocks and products), and troubleshoot job failures.
**[Core Developer]** An experienced software engineer who does not need to have domain expertise, or researcher/domain expert with high technical proficiency. They contribute actively to the core development of FiaB frontend/backend.
**[Operator]** An experienced operator/admin, infrastructure or cloud engineer, who does not need to have domain expertise. They provide the infrastructure to install FiaB, are responsible for configuring the infrastructure and integrating it with monitoring, as well as resolving troubleshoots.

Further guidelines for installation, configuration and troubleshooting are provided in the following documentation:
* [Troubleshooting](troubleshooting.md) -- troubleshooting and tuning. Audience: Operator, Plugin/Core Developer
* [Advanced Installation](installation.md) -- upgrade, reinstall and containerised setup. Audience: Operator, Developer
* [Frontend Development](../frontend/README.md) -- frontend development. Audience: Developer
* [Backend Development](../backend/development.md) -- backend and plugins development. Audience: Developer


## Basic installation (for Forecasters and Plugin Developers)

Pre-requisites (packages that should already be installed on `$PATH`):
* `bash`
* `curl`
The launcher installs everything else into `~/.fiab`. There is no need to clone the whole FiaB repository.

1. Download the launcher:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/ecmwf/forecast-in-a-box/main/scripts/fiab.sh -o fiab.sh
   ```

2. Launch Forecast-in-a-Box. The first run installs the latest release in `~./fiab.sh`, then opens a browser at `localhost:8000`:

   ```bash
   bash ./fiab.sh
   ```

3. Install plugins from the Plugins screen in the UI (optional).
    For installing, configuring and troubleshooting plugins, see [Plugins (basic)](operator/plugins.md).
    Note: A plugin should be installed through the UI, rather than through `pip` into the virtual environment, in order to sync the database with the installed packages.

4. Upgrade FiaB from the terminal. Stop the application first:

   ```bash
   bash ./fiab.sh upgrade
   ```

   Upgrades stay within the same major version. To start from scratch, run:
   ```bash
   bash ./fiab.sh reinstall
   ```
   This deletes `~/.fiab`
    
    Note: The user interface (browser) has embedded help for building and running FiaB.

## Advanced installation (for Core backend/frontend Developers)

Pre-requisites (tools are expected to be found in `$PATH`):
* `just` - run project commands
* `uv` - create and manage Python virtual environments
* `npm` - node package manager
* `git` - cloning and contributing to the repository
* `docker` (optional) - build and run FiaB on containers 

1. Clone the repository and navigate to the root:

   ```bash
   git clone https://github.com/ecmwf/forecast-in-a-box.git
   cd forecast-in-a-box
   ```

2. Launch FiaB from the respository root:

   ```bash
   just dev
   ```

   If the frontend build is missing or out of date, `just dev` asks whether to build it. Answer `y`; pressing Enter skips the build. It also creates `backend/.fiab/`, copies an example `config.toml` into it, and starts the backend with editable installs. Details can be found in [Launching](developer/guidelines/launching.md).

3. To create a new plugin, add its store to `backend/.fiab/config.toml`:

   ```toml
   [external.plugin_stores.myStore]
   url = "file://./packages/fiab-plugin-myproduct"
   method = "localSingle"
   ```

   Stop the backend and run `just dev` again after saving `config.toml`, then install the plugin from the Plugins screen. Plugin development is covered in [Plugins (Developer)](developer/guidelines/plugins.md).

4. Before committing, run the checks described in [Backend Development](../backend/development.md) and [Frontend Development](../frontend/README.md). In short, for backend changes run at the root:
```bash
just val
uv run --project backend prek
```
For frontend changes run in `frontend/`:
```bash
npm run validate:fix
```

5. To reset a checkout's state, run:
```bash
just dev reinstall
```
This drops the local database and recreates the environment.

## Summary differences between user personas

| | Forecaster / Plugin Dev | Core Dev |
|---|---|---|
| Source | Released wheel from PyPI | Git checkout, editable installs |
| Configuration | `~/.fiab/config.toml` | `backend/.fiab/config.toml` |
| Plugins | Installed from the UI | Local store with `file://`, optionally editable |
| Upgrade | `fiab.sh upgrade` | Pull and restart |
| Reset | `fiab.sh reinstall` | `just dev reinstall` |
| Logs | Log files, or `FIAB_LOGSTDOUT=yea` | Same, plus the logs endpoint for a zipped copy |


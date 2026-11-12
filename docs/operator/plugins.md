# Plugins (Operator)

Plugins extend Forecast-in-a-Box with custom products (post-processing steps) and data sources.
This page is intended for Operators (researchers or domain experts) with medium software proficiency. It covers installing, configuring and troubleshooting plugins.
To create a new plugin as a developer, please see [Plugins (Developer)](../developer/guidelines/plugins.md).

## How plugins are installed

Plugins are installed from the Plugins screen in the web interface, not with `pip` into the environment. When you install one, the backend first runs a `pip` dry run. If that succeeds, it installs the package and records it in the `plugin_state` table of the jobs database. That record holds the pip source, the module name and the installed version.

A plugin store is a place the backend can install plugins from. Each store is declared in `config.toml`:

```toml
[external.plugin_stores.myStore]
url = "file://./packages/fiab-plugin-myproduct"
method = "localSingle"
```

`config.toml` holds only the stores, and optionally the default plugins described below. It never records which plugins are installed.

## Default plugins

To install plugins automatically on a fresh installation, list their IDs under `external.default_plugins`:

```toml
[external]
default_plugins = ["yourPluginStore:yourPluginId"]
```

This list is read only on the first run. It is never changed by the backend afterwards.

## Updating and removing plugins

- After you update a plugin, restart the backend. A changed package is not reloaded into a running process.
- Uninstalling a plugin removes its database record and unloads its catalogue and templates; its package and dependencies remain installed. Updating can replace the plugin package and add new dependencies, but preserves every other installed distribution. An update requiring incompatible changes to those distributions is refused.

## Troubleshooting

When an installation fails, the backend log shows the reason. Please inspect the plugin's ID or module name.

| Symptom | What to check |
|---|---|
| The install is refused before anything changes | The dry run failed. The error names the conflicting dependency or constraint. |
| The plugin shows as failed after install | The module failed to import, or its `plugin` attribute is missing or of the wrong type. The failure detail names the error. |
| The plugin works after an update but not before a restart | Restart the backend. |
| The backend is in an inconsistent state after a manual install | Remove the plugin's row from `plugin_state`, uninstall the package from the environment, and install it again from the UI. |
| Nothing else helps | Reinstall with `fiab.sh reinstall` (end user) or `just dev reinstall` (checkout). This deletes the database and the environment. |

For where the logs are and how to get the full stack traces, see [Tuning and Configuration](../tuningAndConfiguration.md#how-to-get-logs).

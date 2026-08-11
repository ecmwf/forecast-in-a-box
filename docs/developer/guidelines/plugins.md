# Plugins

This document describes the Plugin system, means of extending Forecast-in-a-Box with custom products and data sources.
It is intended for developers, and describes what a python package must satisfy to be a well-behaved plugin, and how to setup a local development environment.

There is also a [operator-focused document](../../operator/plugins.md) about plugins, which describes how to configure or troubleshoot a plugin installation.

## Plugin Package

### Core Contract
A plugin is a regular wheel tightly bound to the `fiab-core` [package](../../../backend/packages/fiab-core).
Notably, the `fiab-core` prescribes a Python contract -- each plugin wheel/package *must* expose at the top module a field called `plugin` which is an instance of the dataclass `Plugin` from `fiab-core`'s `plugin.py` submodule.

This is only inspected at runtime -- nothing prevents you from installing an invalid plugin.
Doing so marks the plugin as failed in the backend, displaying the error message (such as `ImportError` or `AttributeError`) as its failure detail.

### Versioning Convention
The plugin expectedly declares `fiab-core` as a required python package.
There is **important convention** for major versioning -- a plugin should have the same major version as the `fiab-core` it is compatible with.
There will never be breaking/backwards incompatible changes in `fiab-core` in minor/patch version increments.
Minor releases of `fiab-core` may add new fields or functionality, but never without defaults etc -- ie, they will stay compatible with plugins corresponding to the major version.
The reason for this convention is displaying correct available versions in the Update dropdown in the UI.
The actual install-time check respects the regular python mechanisms for dependency constraints -- hence a wheel `your-plugin-3.4.5` should have in its `requires` a `fiab-core>=3.0.0,<4.0.0`.

### Other Dependencies
A plugin would ideally not have dependencies that are not part of the existing backend's dependencies, because having any puts it at possible odds with other plugins.
For all dependencies (novel or shared with backend), they should be as uconstrained as possible.
If a constraint is incompatible with backend, the plugin will not be installed -- we propagate the backend's constraint into the `pip` invocation, meaning pip will refuse to execute the command.
The same for an already installed plugin with incompatible constraint.

## Local Development
It is assumed that for development, you have a repository containing your plugin as a python project.
You can then use for the backend both a production-install (using the `fiab.sh` script) or a development-install (using the `just dev` command).
Either way, you need to have the following in your `config.toml` something like this:
```
[external.plugin_stores.yourPluginStore]
url = "file://./packages/fiab-plugin-test"
method = "localSingle"
```
The `yourPluginStore` is an arbitrary string, and the `url` needs to specify the path to the package.
This example shows how the existing `fiab-plugin-test` in the `forecastbox-in-a-box` repository itself is configured.
It is assuming that it is launched via `just dev`, hence the relative path to the package resolves correctly.
You may want to put there absolute path instead if you don't want to reason about where the `fiab.sh`/`just dev` are.

This makes the plugin installable by the backend, ie, go to backend's screen for Plugins and install by clicking.
That will run the `pip install <url>`. You _can_ include `-e` in the url, which will give you an editable install.
We don't support live reloads, ie, if you make code changes, you best restart the backend (but you don't need to reinstall the plugin).

Do not install the plugin yourself into the backend's venv -- a part of the installation process is inserting
an entry into the database as well as into the config file. Failure to do so may leave the backend in an inconsistent state.
If you want to test the "would it actually install" outside of backend, you may run `uv pip install --dry-run` with the respective `venv` to see what would happen -- this is definitively recommended if you want to see the possible error line hands-on and fast.

## Troubleshooting
If things go very wrong, you can wipe the `venv` and the database (in `.fiab/jobs.db`), and remove a section looking like
```
[external.plugins."localTest1:single"]
pip_source = "file://./packages/fiab-plugin-test"
module_name = "fiab_plugin_test"
```
from your `config.toml` (**not** the `external.plugin_stores` config you have added before -- this is the plugin itself, a record of its installation, added _automatically_ during the installation process).
Next run of `just dev`/`fiab.sh` would re-create the db and venv in a pristine state, and a next install of the plugin would add the entry to config.

You can attempt a finer surgery instead -- delete the line corresponding to your plugin from the `plugin_state` table in the database (it's just sqlite), uninstall the package from the venv, and remove the corresponding section from the config.
If you have external dependencies by your plugin, you need to handle them manually as well.

Multiple things can go wrong: Installation, Import, Update, Uninstallation.
Every case can be investigated by hand, outside of the backend environment, in a plain python shell or uv commands.

For the install, it is the pip install --dry-run described above.
The backend does actually a much more complicated thing because it strictly wants to preserve its existing venv.
If you see "too many changes" in your pip install dryrun, investigate them -- maybe you have too many external dependencies or constraints?

For the import, you can simply try to import your module and access the `plugin` attribute, and verify it being an instance of the `Plugin` class from the `fiab-core`.
This could possibly reveal a mismatch between your plugin's `fiab-core` expectaction and the actual version.
Another possible source of issues is that changing a python package in an _already running_ python process is fraught with danger.
Generally, restarting the backend after a plugin update may make weird issues go away.

For the update/uninstall, mind we don't uninstall the external requirements, only the plugin wheel itself.
If your external requirements constraint changes across your plugin version, you _must_ handle by hand.
We expect to improve it in a later version, but it is not easy.

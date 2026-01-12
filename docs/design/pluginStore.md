# Design for Plugin Installation User Story

## User Story
* As a developer, I have implemented a Fable Plugin, and uploaded it to PyPI. Now I want to register it somewhere, so that users can install it to their FIAB environments without pasting PyPI urls
* As a user, I want to list what plugins I have installed, what is their status (imported, failed), list which plugins are available in a "plugin store", and install selected ones

## Design Elements

### Server-like component
A static file on github, in this repo's install/ folder -- which already hosts similar kind of data. A structure file with entry per plugin, consisting of:
* plugin id (I guess I'll use hash of pypi url + module name)
* pypi url
* plugin module name (importable)
* plugin display name
* plugin display description
* plugin author

### Backend API changes
* add a get pluginStore() endpoint which pulls the plugin store data (in a cached manner -> there will be optional forceRefresh param) and returns the list of plugin metadata as above + possibly status if installed (version, install date?, possible import error)
* add an post install(plugin_id) endpoint which just installs (or updates if already installed)
* add an post uninstall(plugin_id) endpoint which just uninstall

### Backend new areas of concern
* add manipulation of the config file (to persist the install/uninstall commands)
* add github file fetch
* add metadata file
* ...

### Tooling/CI
It would be nice to have a reference script or tool that takes a wheel and generates the corresponding plugin store catalog entry. Maybe even check validity and compatibility. Sorta like twine

The flow is be that the plugin author opens a PR to the fiab repo by adding the snippet.
The tool does not create the PR, but has an `--addFile .. --toCatalogue ..` arg which automates the adding part (and runs like json/yaml validator, etc).

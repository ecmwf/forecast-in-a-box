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
* config has a new element `[pluginStoreUrl]`, coming with a default url of ecmwf plugin store, and can be changed -- but this is not exposed via backend API
* add a get pluginData endpoint which pulls the plugin store data from each configured store (in a cached manner -> there will be optional forceRefresh param) and returns a merged list of plugin metadata:
  - plugin id
  - from store
    - plugin display name, plugin display description, plugin id
    - plugin store id & name
    - plugin author
  - from pypi
    - plugin most recent version & release date (_note_: i will need to check if those data are reasonably accessible -- we don't control this)
  - from installation (if installed)
    - plugin version, plugin install time, plugin status (disabled/error/imported) 
    - _note_: plugin id can be used to look up in the fable catalog to see which blockFactories are corresponding to that plugin
* add a post install(pluginId, targetVersion: optional|latest) endpoint which just installs, or updates if already installed
* add a post uninstall(pluginId) endpoint which just uninstalls
* add a post setStatus(pluginId, enabled: bool)

### Backend new areas of concern
* add manipulation of the config file (to persist the install/uninstall commands)
* add plugin store config section
* add plugin store file fetch from github
* investigate how to derive the install time etc
* support the setStatus
* ...

### Tooling/CI
It would be nice to have a reference script or tool that takes a wheel and generates the corresponding plugin store catalog entry. Maybe even check validity and compatibility. Sorta like twine

The flow is be that the plugin author opens a PR to the fiab repo by adding the snippet.
The tool does not create the PR, but has an `--addFile .. --toCatalogue ..` arg which automates the adding part (and runs like json/yaml validator, etc).

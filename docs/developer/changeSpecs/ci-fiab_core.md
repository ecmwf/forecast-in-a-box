# Current State
## As of 2026.06.04
`fiab-core` package is not present in the pylock, hence only the range spec in backend's pyproject (`>=0.0.5,<1.0.0`) takes effect, pulling the newest or cached version that satisfies it.

When installing a plugin, we don't check what version of fiab-core it is compatible with.
We allow any plugin installation, which can in turn trigger fiab-core upgrade/downgrade, which will then manifest in the next run.

We currently release all plugins together, meaning a single version of (fiab-core, ecmwf-plugin) is test-guaranteed to work together.
This additionally creates a tag to provide compatibility guarantees with artifacts, but does not automatically change the range in backend's pyproject anyhow.

Ideally, we would not allow the user or the developer to create a broken state, that is, a venv where incompatible versions are installed.
Alternatively, we could provide self-diagnostic checks, and means to restore a working state.

We need to address three scenarios:
1. **Install**: how to let the user run only compatible plugin installs or updates,
2. **Release**: how to execute releases of plugins, core, and backend,
3. **Migration**: how to manage saved presets and runs in the presence of a plugin update.

## Update on 2026.06.23
1. There are three `cd` actions:
  1. `cd-core` -- releases `fiab-core` and `fiab-plugin-test wheels, versioned by `cX.Y.Z.d` repo tag,
  2. `cd-plugins` -- releases `fiab-plugin-{ecmwf, demo}` wheels, versioned by `pX.Y.Z` repo tag, 
  3. `cd-backend` -- releases `forecastbox` wheel including the `.js` package, versioned by `vX.Y.Z` repo tag.
2. The compatibility is driven by the major version being equal -- hence `v1.?.?` backend requires `c1.` and `p1.` plugins.
3. The release actions are capable of deriving tags automatically, fail hard if there is no corresponding `core` version (for backend/plugins), automatically update constraints in `pyproject.toml` in case of major version increase.
4. Unlike `ci`, the `cd` actions don't rely on repo-wide venv with local editable installs, but instead install fiab-core and fiab-test-plugin from pypi based on the most recent compatible version. This leads to a discrepancy between `ci` (which tests "this commit of the repo is mutually compatible") and `cd` (which tests "this wheel, installed clean, works") and may lead to situations where `ci` passes but `cd` does not -- but that is a necessary cost given different release timelines.
5. On the client, the major-version is taken into account when dealing with plugins in general.

# The Install Scenario
## Options
1. Rely on python wheel metadata: a) set all constraints correctly in plugins and backend b) read metadata in advance, to allow only legitimate state changes
2. External solution, such as some plugin registry, which would contain known-to-work combinations

### Wheel-based solutions in detail
**Option A**: Each plugin would declare the fiab-core range in its `pyproject.toml`. The downside is we need to download and parse each wheel first to extract this information.

**Option B**: Each plugin would mirror fiab core major versioning -- that is, plugin of version `X.a.b` is compatible with fiab-core of version `X.c.d` for any combination of a, b, c, and d. This allows for faster PyPI scans, but does not prevent a breaking installation, and does not allow for finer range specifications (which we may want to discourage anyway).

Note: Options A and b can be combined -- B to provide fast PyPI scans, A to provide more safety once the wheel is downloaded.

### External solutions in detail
Currently, the plugins.json contains only the names of the plugins, but we could extend it with a compatibility matrix.
A publish of either a plugin or a core would run the respective compatibility suite to complete the missing matrix cells.
The biggest downside is the overhead and maintenance of this solution -- both server-side and git-side solutions would involve lot of code.

For a new plugin author, it additionally requires communication with the core maintainers every time a new version is installed.
However, this is potentially a security feature, as it would allow us to scan the wheel before distributing it.

## Suggestion
We go with wheel-based solution and use both option A and option B.
This could go wrong if any individual plugin fails to respect either convention, and the user won't detect it at runtime -- we accept that, there is no good solution.
This does not provide security guarantees, hence we need to allow only trusted institutions to register their plugins forever in the plugins.json -- we accept that, and trust pypi default security scanners.

# The Release Scenario
For plugins that are managed outside of the monorepo, the situation is relatively simple -- releases of core may be reacted upon in an eventual fashion.

The challenge is primarily for the monorepo -- do we want to always release all three components (backend, core, plugin) together, or individually?
Let's assume we are careless, make a backwards incompatible change to fiab-core but don't release, and then release a backend.
Despite passing all the tests, the backend wheel is broken, because the tests are natively executed with respect to the current repo state.

We could change the `cd` mechanism to only install released versions, but that allows for three different solutions:
1. make the code change in all projects simulatenously, and release components one by one (which makes the `cd` temporarily broken for all but one component),
2. make the code change in all projects simulatenously, and release components in a single action (which makes the `cd` most complicated),
3. make the code change gradually (which makes the default venv broken in the intermediate phase).

That deals only to `core` releases -- plugin and backend minor releases can stay independent and simple.

Alternatively, we would restructure the monorepo from the current "backend and its packages" to "backend, core, plugin", all living on the top-level, without a single venv.
That would probably reduce the amount of fighting with `uv` (eg, it would be easier to test a plugin against a particular version of core), but make the developer experience otherwise more complicated (there would be no single uv venv anymore, and you would have to be more conscious about what you are doing).

In either case, it is not clear what the `ci` action should mean -- if it means "the current state of the repo acros all its projects is compatible", it again forbids gradual code change.

Lastly, we could break the monorepo into individual repositories -- with all its ups and downs.

## Suggestion
The repo stays organized as is.
The `ci` means "all projects are mutually consistent in its current state".
There would be three `cd` actions, `cd-core`, `cd-backend`, and `cd-plugin` -- where the core releases all three with major version bump, whereas -backend and -plugin allow only for minor/patch bumps, and would run the pre-release test with pypi-provided core -- thus may fail despite `ci` passing before, and this would mean `cd-core` should have been run instead.

# The Migration Scenario
Note: we don't discuss migration of the underlying local database in case the schema changes, but rather, migration of saved presets and blueprints in case of plugin update.
The latter is thought to be more common, and more plugin-specific.

## Options
1. **Struthio**: re-executing or loading a blueprint may work ok, or crash at compilation where it previously worked, or behave differently at runtime.
2. **Hic Sunt Leones**: we extend the `blueprint` table schema with `fable-core` version, and display a warning icon with "may misbehave" in case it differs from the current one. Loading and saving again clears the warning (as it internally increases the version in the db entity).
3. **Loquax**: we extend the `blueprint` table schema with a dict of core & plugin versions, display a warning icon in case of any mismatch, and generate links to release notes
4. **Labora et Ora**: each plugin would expose proper migration interface -- how to convert blocks from previous versions to the new one, or err if impossible

## Suggestion
Hic Sunt Leones.

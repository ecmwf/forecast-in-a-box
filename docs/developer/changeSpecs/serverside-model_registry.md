# Next steps for Model Registry Feature

## Affected User Flows
User wants to run a forecast using a model checkpoint.

## Current Status
### As of 2026.06.03
A model registry exists as a file on github, see the `install/` at the repo's top level.
There is an `artifacts` domain and router in the backend that interacts with it.
The `fiab-core` package within backend defines the basic contract.
However, the maintenance of that file on github is manual.

This additionally has the downside that the schema of the json file / the contract in the `fiab-core` must remain stable and forward-compatible.
In particular, it forbids us merging any breaking changes into the `main` branch -- and that is unacceptable.

There are two assumptions:
1. Model releases are occassional now, but expected to increase in the future -- thus a short term solution can involve a chore when there is a new model, but a long term solution cannot.
2. We expect to have a number of distinct clients in the wild -- multiple deployment scenarios, not necessarily sharing the same version or feature set. This is expected to only grow.

### Update on 2026.06.04
We have implemented the `Finer git-side management` option, see below for details, and assume that server side is the long term goal.
Migration towards server-side would involve:
1/ adding a new ArtifactsStoreConfig option and its implementation -- presumably utilizing the same `core_version` variable required for the newly-added `gittag` option.
2/ changing the `just val` of fiab-core to instead validate the artifacts compatibility with the server
3/ the `cd-artifacts_update.yml` GH action would become a CLI command instead

## Options

We have the following options:
* A proper server with the registry
  * upside: would version the schemata, thus support older clients without sacrificing on the schema evolution. CI would install selected older fiab-core versions and test against the server
  * upside: would automate eg model-platform compatibility determination, update profiling information / recommended config per platform, et cetera -- anything that needs non-trivial lifecyle
  * downside: deployment hassle and maintenance of another independent codebase
* Hardcoding artifact list into the plugin
  * upside: most reliable -- we can, at the wheel publish time, verify that all the jsons in the plugin can be parsed by it
  * downside: non-trivial rework of the logic -- current backend mandates the plugin load to finish after artifacts load
  * downside: new model release requires new plugin release, for each LTS version
  * downside: artifacts wouldn't be shareable between plugins
* Finer git-side management -- instead of `main`, pull from `c<fiab-core-version>` tag which we create just for this purpose
  * upside: somehow reliable and flexible, with the smallest amount of code changes -- best stepping stone toward server side solution
* Client-side flexibility -- we would improve the client side logic to be more tolerant
  * downside: this actually won't work, ie, the need for forward compatibility would remain, and would put burden on developers to reason correctly

### Server
We create a standalone python package with multiple CLI entrypoints:
- `extract_basic_metadata` -- reads the checkpoint, extracts present metadata, and outputs a json / extends existing modelRegistry.json,
- `verify_unpickling` -- spawns a new process with empty venv, installs requirements exactly as given in the checkpoint, and attempts to unpickle,
- `log_run` -- spawns a new process with anemoiInference and dummy data, produces a detailed torch trace
- `compare_runs` -- given two log runs, presumably with different torch versions or architectures but identical input, produces comparison analysis of numerical divergence
- `update_metadata` -- given a verification of unpickling or run comparison result, updates said entry in modelRegistry.json

We'll have a centrally deployed server, holding the modelRegistry.json (rather a sqlite table with CheckpointId key and CheckpointData blob), with endpoints:
 - `get checkpoints() -> dict[CheckpointId, CheckpointData]`,
 - `put register(checkpointUrl)`, which would basically trigger invocation of the script above, possibly across multiple hosts and clouds.

The server would version the schemata, thus support older clients without sacrificing on the schema evolution.
CI would install selected older fiab-core versions and test against the server

### Finer git-side management
Details of the solution:
1. When we release fiab-core, it would involve parsing the artifacts.json at the given commit -- and if it fails, no release happens
2. Each release of the fiab-core tags the respective commit with its version, with prefix `c` to not mix with the `v`/`d` prefixes uses by regular releases
3. We would extend the current fixed-url fetching of registry with fiab-core-version parametrized. Note that `fiab-core` is loaded in a fixed fashion at the start, ie, it is not a plugin itself -- thus we don't have a race condition / timing issue
4. We will have a github action 'update fiab-core tag', which would verify that the only changes of the branch it runs on compared to the given fiab-core tag happen only on the artifacts.json, then it would test parsing the artifacts.json with the corresponding fiab-core version, then it would update the tag. (Or the tag would be x.y.z.D and it would be a new one -- sounds safer)

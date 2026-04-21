# Next steps for Model Registry Feature

## Affected User Flows
User wants to run a forecast using a model checkpoint.

## Current status
A model registry exists as a file on github, see the `install/` at the repo's top level.
There is an `artifacts` domain and router in the backend that interacts with it.
The `fiab-core` package within backend defines the basic contract.
However, the maintenance of that file on github is manual.

### Change Proposal: A proper server instead of Git Registry File
We create a standalone python package with multiple CLI entrypoints:
- `extract_basic_metadata` -- reads the checkpoint, extracts present metadata, and outputs a json / extends existing modelRegistry.json,
- `verify_unpickling` -- spawns a new process with empty venv, installs requirements exactly as given in the checkpoint, and attempts to unpickle,
- `log_run` -- spawns a new process with anemoiInference and dummy data, produces a detailed torch trace
- `compare_runs` -- given two log runs, presumably with different torch versions or architectures but identical input, produces comparison analysis of numerical divergence
- `update_metadata` -- given a verification of unpickling or run comparison result, updates said entry in modelRegistry.json

We'll have a centrally deployed server, holding the modelRegistry.json (rather a sqlite table with CheckpointId key and CheckpointData blob), with endpoints:
 - `get checkpoints() -> dict[CheckpointId, CheckpointData]`,
 - `put register(checkpointUrl)`, which would basically trigger invocation of the script above, possibly across multiple hosts and clouds.

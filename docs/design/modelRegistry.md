# Design for Model Registry Feature

## Affected User Flows
User wants to run a forecast using a model checkpoint.

## Motivation
Metadata from the checkpoint affect not just the run of the forecast, but also _building_ of the Fable Job in the first place.
In particular, we need to know:
 - what are the package requirements and constraints, such as torch version, of the checkpoint,
 - what configuration options does it provide (e.g., ensemble members),
 - what are the infrastructure requirements (CUDA/Metal compatiblity, memory requirements),
 - what are input requirements: what variables, grids, etc, it needs,
 - what are the output options: what variables, time steps, etc.
A straightforward option involves downloading the checkpoint and extracting metadata from it.
That, however, involves potentially costly download, and risks installing torch to the backend venv -- but we don't know what version beforehand, and we can't install more than one.

Additionally, checkpoints currently don't expose in metadata any compatibility information, such as with Apple's Metal framework.
Ideally, we would derive those once, and expose to any FIAB user.

## Proposal

### Phase 1: Git-based Registry File & Registrator Script
1. We define a Pydantic-based contract for all the metadata, as a part of fiab-core. No other dependencies.
2. Add a modelRegistry.json to the fiab git, similarly to how plugin stores is handled, with a `checkpointId->metadata` lookup.
3. We create a standalone python project with multiple CLI entrypoints:
  - `extract_basic_metadata` -- reads the checkpoint, extracts present metadata, and outputs a json / extends existing modelRegistry.json,
  - `verify_unpickling` -- spawns a new process with empty venv, installs requirements exactly as given in the checkpoint, and attempts to unpickle,
  - `log_run` -- spawns a new process with anemoiInference and dummy data, produces a detailed torch trace
  - `compare_runs` -- given two log runs, presumably with different torch versions or architectures but identical input, produces comparison analysis of numerical divergence
  - `update_metadata` -- given a verification of unpickling or run comparison result, updates said entry in modelRegistry.json
4. We add model registry config to fiab, and implement fetching-on-start
5. We extend the fable compilation with `get_checkpoint_realpath(checkpointId) -> pathlib.Path`, which would return where on the host the checkpoint is physically located
  - if the checkpoint is not downloaded, calling this will trigger the download in the background (or maybe just carry that information and trigger at execution time)
6. We will rewrite anemoi-plugin to interact with the pydantic metadata object & `get_checkpoint_realpath()` instead at the fable building time
7. The job execution will be delayed until the model download has finished

### Phase 2: A proper server instead of Git Registry File
We'll have a centrally deployed server, holding that modelRegistry.json (rather a sqlite table with CheckpointId key and CheckpointData blob), with endpoints:
 - `get checkpoints() -> dict[CheckpointId, CheckpointData]`,
 - `put register(checkpointUrl)`, which would basically trigger invocation of the script from previous phase, possibly across multiple hosts and clouds,
but the API inside FIAB would be basically unchanged.

### Note on Evolution
The metadata object would be versioned and extensible.
When a new field is added to the metadata, it needs to contain an "undefined" option which would be the default.

We need to account for definition of `is_compatible` changing over time, for new platforms popping up, for new means of integrating the model in workflows, etc.

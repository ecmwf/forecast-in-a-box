# Forecast in a Box

Project is in experimental stage. Don't use this yet.

## Design And Purpose
The singular purpose of this project is to allow users to execute *Jobs* -- a single Job is for example "retrieve data from Mars, run a ML model to yield forecasts, run specified postprocessing, convert the result to a visual representation", in this case four atomic Tasks, each executed in its own process.
The User selects in the browser UI which Job type to run, provides parameters, and submits.
Individual Tasks of the Job are then executed (possibly in parallel), and at the end the result is viewed in the browser.

A Job is based on a template -- a DAG of TaskDefinitions, where each prescribes what parameters can the user specify as well as what inputs are expected from previous Tasks, if any.
The job templates are currently hardcoded, but we will eventually support a plugin-like dynamic system.
The implementations of the Tasks themselves are [here](src/forecastbox/external), while the templates are [here](src/forecastbox/plugins/lookup.py).

There are three server components in total:
 * [UI](src/forecastbox/ui) -- a FastAPI server for providing html responses / accepting filled HTML forms. Light on business logic, just frontend.
 * [Worker](src/forecastbox/worker) -- a FastAPI server that launches and monitors a process for every Task, manages the shared memory for passing outputs of Tasks as inputs to other Tasks.
 * [Controller](src/forecastbox/controller) -- a FastAPI server that glues between UI and Worker. Note that there will eventually be more Workers, eg in a cluser setting, as well as more UIs, but there will always be one Controller. Holds the business logic of building Task schedules, keeps track of what is running where, et cetera.

### Lifecycle of a Job
1. The user selects in the UI a JobType -- from the selection determined by what the plugin manager currently is aware of.
2. The plugin manager converts the JobType into a JobTemplate, which the UI then converts to a HTML form for the user to fill the params in.
3. The user fills the params in the form and submits, signaling their intent for launching the Job.
4. The plugin manager validates the params & template, and converts into a TaskDAG.
5. The scheduler (a module of the Controller) converts the TaskDAG into a schedule, ie, assigns to workers and linearizes.
6. Workers will start launching processes, sending updates to Controller to update internal state.
7. The user refreshes the UI until results are obtained.

All contracts and messages are defined [here](src/forecastbox/api/common.py). We use pydantic for inmem & serde, and json for on the wire.
None of the messages contains anything Task/Job specific, ie, its serdeable with just the `api.py` module + pydantic
(this may later change with Task-specific validations).
The only place where Task/Job specific code is inside the Worker-launched process, which starts by `importlib` invocation for the module path listed in the TaskDefinition.
This saves us from the need to pull all requirements of all possible Tasks everywhere.

### Packaging
TODO fill in desc

## Developer Experience
### Local Development
Use the commands defined in the [justfile](./justfile) -- firstly, install `just` via e.g. `brew install just`, unless you have it already on your system.
It's just a bit fancier Makefile, nothing magical.
Then you once run `just setup` in this repo (this creates a `.venv` and installs both package and devel requirements) -- only ensure that `python` in your system is something like 3.10+.
And whenever you want to test your local changes, just run `just val` -- no need to activate your local venv/conda.

Note that two commands, `run_venv` and `dist` accept a parameter, representing a path on your system to the directory with models (presumably ckpt files).
We don't want to commit those models to git (due to both size and privacy reasons), and we don't have yet integrated remote fetching thereof, so you need to set it up yourself.

**CAVEAT** regarding environments -- the situation is a bit shaky due to the current need to embed all job requirements into a single one.
This is long-term untenable situation, but that's the state we are at.
The `requirements.txt` supports most of the `hello_` jobs, except for `hello_aifs` which needs the `requirements-aifs-linux.txt` -- and note that that one depends on particular commit of `aifs-mono`.

**CAVEAT** regarding models -- they are not committed to the repo, due to confidentiality reasons.
We don't support remote retrieval just yet, you need to obain them manually.

### Linting and Formatting
We have [pre-commit](https://pre-commit.com/) configured for this repo, as a part of the `just setup` action. It means that `.git/hooks/pre-commit` is configured to always run linting/formatting whenever you `git commit` (unless you do `git commit --no-verify` for e.g. work-in-progress commits that you want to amend later). You do not need to care about which venv you commit from, the git hook has its own config.

### CI
TBD

### Deployment
TBD

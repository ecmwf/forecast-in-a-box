# Forecast in a Box

Project is in experimental stage. Don't use this yet.

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

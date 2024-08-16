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

### Linting and Formatting
We have [pre-commit](https://pre-commit.com/) configured for this repo, as a part of the `just setup` action. It means that `.git/hooks/pre-commit` is configured to always run linting/formatting whenever you `git commit` (unless you do `git commit --no-verify` for e.g. work-in-progress commits that you want to amend later). You do not need to care about which venv you commit from, the git hook has its own config.

### CI
TBD

### Deployment
TBD

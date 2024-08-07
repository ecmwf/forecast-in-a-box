# Forecast in a Box

Project is in experimental stage. Don't use this yet.

## Developer Experience
### Local Development
Use the commands defined in the [justfile](./justfile) -- firstly, install `just` via e.g. `brew install just`.
Then you once run `just setup` (this creates a `.venv` and install both package and devel requirements) -- only ensure that `python` in your system is something like 3.10+.
And whenever you want to test your local changes, just run `just val` -- no need to activate your local venv/conda.

### Linting and Formatting
We have [pre-commit](https://pre-commit.com/) configured for this repo, as a part of the `just setup` action. It means that `.git/hooks/pre-commit` is configured to always run linting/formatting whenever you `git commit` (unless you do `git commit --no-verify` for e.g. work-in-progress commits that you want to amend later). You do not need to care about which venv you commit from, the git hook has its own config.

### CI
TBD

### Deployment
TBD

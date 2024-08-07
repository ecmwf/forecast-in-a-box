# Forecast in a Box

Project is in experimental stage. Don't use this yet.

## Developer Experience
### Local Development
Use the commands defined in the [justfile](./justfile) -- firstly, install `just` via e.g. `brew install just`.
Then you once run `just setup` (this creates a `.venv` and install both package and devel requirements) -- only ensure that `python` in your system is something like 3.10+.
And whenever you want to test your local changes, just run `just val` -- no need to activate your local venv/conda.

### CI
TBD

### Deployment
TBD

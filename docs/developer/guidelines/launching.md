# Launching

This document describes how to launch the Forecast-in-a-Box as a developer -- assuming you want to develop it, or develop a particular plugin within it.

## How to Launch

There are two ways of launching:
1. use the script `fiab.sh`, located at the repo root in `scripts/fiab.sh`,
2. or run `just dev` using the `just` command runner in the repository's root.

The `fiab.sh` is a standalone script, meaning you don't need to check out the repo itself, and it installs itself in `~/.fiab` (configurable).
It generally pulls the most recent released version, but it is still based on a `venv`, and you can configure it arbitrarily, including editable installs of plugins.
However, a plugin should be installed through UI (or backend API call to be precise) rather than directly through pip into the venv, at least for the first time, as that puts the right entities into the database/config.
Consult [plugins.md](./plugins.md) for more details about plugin installations.

The `just dev`, on the other hand, reflects the current state of the repo you have checked out, meaning every component (the backend, the frontend, the core for plugin contract) is an editable install in the repo.
And similarly to the `fiab.sh`, you can configure it arbitrarily, including editable installs of plugins.

## Configuration

The `fiab.sh` allows for numerous environment variables, like which released version to pull, what `uv` or `venv` to use, where to actually install, et cetera.
Those make no sense for `just dev`, because that's hardwired to use the state of the repository.

Behavioral and runtime configuration, like where to read plugins from or what port to bind comes from `config.toml` (whose individual entires can also be superseded by an envvar).
The difference is where the file is expected to exist:
1. `fiab.sh` expects it at `~/.fiab` directory (or `$FIAB_HOME` if you need to overwrite),
2. `just dev` expects it at the `<repo>/backend/.fiab` directory.

To understand what should be in the file, consult the file `utility/config.py` in the backend codebase -- its the Pydantic model directly corresponding to that file.

## Persistence

Forecast-in-a-Box is persistent -- meaning plugin installation, job submission history, artifacts, and others remain even if you restart the process, the browser, the computer, the simulation of the world.
This persistence is via sqlite databases, `jobs.db` and `user.db`, located in either `~/.fiab` or `<repo>/backend/.fiab` directories, depending on launch method.
The database is created from scratch if not found -- meaning if you need to clean history completely, just delete the `.db` files.
You can also manually manipulate entries in the database if you need a fine surgery.
Alternative to get a tabula rasa is giving `--full-reinstall` to either `just dev` or `fiab.sh`, which is a more thorough wipe than just the db.

There is some persistence in the browser cache, so in case the frontend seems glitchy, do a force reload.

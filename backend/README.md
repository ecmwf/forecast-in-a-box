See project's [readme](https://github.com/ecmwf/forecast-in-a-box/blob/main/README.md).

# Development

## Setup
There are two options:
1. create manually a `venv` and install this as an editable package into it,
2. use the [`fiab.sh`](../scripts/fiab.sh) script.

The first gives you more control, the second brings more automation -- but both choices are ultimately fine and lead to the same result.

For the first option, active your venv of choice, and then:
```
mkdir -p ~/.fiab
uv pip install --prerelease=allow --upgrade -e .[test] # the --prerelease will eventually disapper, check whether pyproject contains any `dev` pins
pytest backend # just to ensure all is good
```

For the second option, check the `fiab.sh` first -- it is configurable via envvars which are listed at the script's start.
In particular, you can change the directory which will contain the venv, and whether it does a PyPI-released or local-editable install.
Note however that in case of the local-editable installs, you *must* execute the `fiab.sh` with cwd being the `backend`, as there is `pip install -e.`.

### Frontend Required
The frontend is actually expected to be present as artifact _inside_ the backend in case of the editable install.
See the [`justfile`](../justfile)'s `fiabwheel` recipe for instruction how to build the frontend and create a symlink inside the backend.

Backend wheels on pypi do contain a frontend copy -- you can alternatively pull a wheel and extract the built frontend into the local install.

## Developer Flow
Primary means is running `pytest`, presumably with the `pytest.ini` section from `pyproject.toml` activated.

Type annotations are mostly present, though not enforced at the moment during CI (but expected to in the near future).

In the [`bigtest.py`](../scripts/bigtest.py) there is a larger integration test, triggered at CI in addition to the regular `pytest` -- see the [github action](../.github/workflows/bigtest.yml) for execution.

## Architecture Overview
Consists of a four primary components:
1. JavaScript frontend as a stateless page, basically "user form → backend request" -- located at [frontend](../frontend),
2. FastAPI/Uvicorn application with multiple routes, organized by domain: auth, job submission & status, model download & status, gateway interaction, ...
3. standalone "gateway" process, expected to be launched at the beginning together with the Uvicorn process, which is the gateway to the [earthkit-workflows](https://github.com/ecmwf/earthkit-workflows),
4. persistence, based on a local `sqlite` database.

Configuration is handled by the `config.py` using pydantic's BaseSettings, meaning most behaviour is configurable via envvars -- see `fiab.sh` or tests for examples.
See [tuning and configuration](tuningAndConfiguration.md) guide for more.

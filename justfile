dbuild:
    docker build -t fiab-be -f backend/Dockerfile backend

drun-mongo:
    docker run --rm -it --network host mongo:8.0

drun:
    docker run --rm -it --network host --name fiab-be fiab-be

### BELOW IS DEPRECATE, DELETE SOON

# this makes all the commands here use the local venv
set dotenv-path := ".env"

# creates local venv, install package + dev requirements
setup:
	python -m venv ".venv"
	echo 'VIRTUAL_ENV=".venv"' > .env
	echo 'PATH="$(VIRTUAL_ENV)/bin:$(PATH)"' >> .env
	pip install uv
	uv pip install --upgrade -r requirements.txt
	uv pip install --upgrade -r requirements-dev.txt
	uv pip install -e .

# installs and configures pre-commit package
setup-precommit:
	uv pip install pre-commit
	pre-commit install

# TODO checksum of requirements, store file inside venv, run pip --upgrade if change detected as a dependency task for `val`

# runs validation suite: mypy, tests
val:
	mypy src --ignore-missing-imports
	mypy tests --ignore-missing-imports
	pytest tests

# runs the whole app (webui+controller+worker)
run_venv model_repo:
	FIAB_MODEL_REPO={{model_repo}} python -m forecastbox.standalone.entrypoint

# builds the single executable
dist_full model_repo:
	# NOTE collect all (default, earthkit) + metadata copy (earthkit) is needed to make earthkit even importible
	# NOTE climetlab, aifs, torch_geometric, pil and einops are needed for aifs suite to work
	# NOTE coreforecast (needed by neuralforecast lib) by default misses libcoreforecast.so
	pyinstaller \
		--noconfirm \
		--collect-submodules=forecastbox --add-data "src/forecastbox/frontend/static/*html:forecastbox/frontend/static" \
		--collect-all=default --collect-all=earthkit --recursive-copy-metadata=earthkit \
		--collect-all=climetlab --recursive-copy-metadata=climetlab \
		--collect-all=aifs --collect-submodule=aifs \
		--collect-all=coreforecast \
		--collect-all=torch_geometric --collect-submodule=torch_geometric \
		--collect-all=einops --collect-submodule=einops \
		--collect-all=PIL --collect-submodule=PIL \
		--add-data "{{model_repo}}:forecastbox/external/models" \
		./src/forecastbox/standalone/entrypoint.py
	# NOTE add -F to build a single executable -- but prolongs build time by about 10 min and can crash due to size
	# NOTE once dlls etc needed https://pyinstaller.org/en/stable/spec-files.html#adding-files-to-the-bundle

dist model_repo:
	# like dist_full, but assumes all tasks install their own env using the TaskEnvironment
	# NOTE we exclude a few of things, but that will vanish once forecastbox.external will become truly external
	pyinstaller \
		--noconfirm \
		--collect-submodules=forecastbox --add-data "src/forecastbox/frontend/static/*html:forecastbox/frontend/static" \
		--exclude-module=torch \
		--exclude-module=numpy \
		--exclude-module=PIL \
		--exclude-module=earthkit \
		--exclude-module=climetlab \
		--exclude-module=anemoi \
		--exclude-module=dask \
		--exclude-module=gribapi \
		--exclude-module=IPython \
		--exclude-module=ecmwflibs \
		--exclude-module=pandas \
		--exclude-module=numcodecs \
		--exclude-module=netCDF4 \
		--add-binary ./.venv/bin/uv:uv \
		--add-data "{{model_repo}}:forecastbox/external/models" \
		./src/forecastbox/standalone/entrypoint.py
	# NOTE add -F to build a single executable -- but prolongs both build and run times

# runs the single executable
run_dist:
	./dist/entrypoint/entrypoint

# builds ubuntu docker image
build_docker:
	docker build -t fiab:ubuntu .

# runs ubuntu docker image
run_docker:
	docker run -p 8000:8000 -p 8002:8002 --rm -it fiab:ubuntu

# builds a regular python wheel
wheel:
	python -m build --installer uv

# builds ubuntu docker image with uv-based bootstrap
build_docker_uv: wheel
	docker build -f Dockerfile-uv -t fiab-runner-base .

# runs ubuntu docker image with uv-based bootstrap and a mounted local dir with ml models
run_docker_uv model_repo:
	docker run \
		--rm -it \
		--network host \
		-v {{model_repo}}:/fiab/models:ro \
		-v ~/.ecmwfapirc:/root/.ecmwfapirc:ro \
		fiab-runner-base

# deletes temporary files, build files, caches
clean:
	find . -name '*.egg-info' -exec rm -fr {} +
	find . -name '__pycache__' -exec rm -fr {} +
	rm -rf build dist lightning_logs
	rm -f entrypoint.spec # NOTE we may want to actually preserve this, presumably after `dist` refactor. Don't forget to remove from .gitignore then

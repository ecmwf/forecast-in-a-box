# this makes all the commands here use the local venv
export VIRTUAL_ENV := ".venv"
export PATH := VIRTUAL_ENV + "/bin:" + env_var('PATH')

# creates local venv, install package + dev requirements
setup:
	python -m venv $VIRTUAL_ENV
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

# runs just the webui fastapi server in development mode (eg with file reloads)
run_webui:
	fastapi dev src/forecastbox/web_ui/server.py

# runs the whole app (webui+controller+worker)
run_venv:
	python -m forecastbox.standalone.entrypoint

# builds the single executable
dist:
	# NOTE collect all (default, earthkit) + metadata copy (earthkit) is needed to make earthkit even importible
	pyinstaller \
		--collect-submodules=forecastbox \
		--add-data "src/forecastbox/web_ui/static/*html:forecastbox/web_ui/static" \
		--collect-all=default \
		--collect-all=earthkit \
		--recursive-copy-metadata=earthkit \
		-F ./src/forecastbox/standalone/entrypoint.py
	# NOTE disabled until install works
	#	--add-data "src/forecastbox/jobs/models/nbeats.nf:forecastbox/jobs/models" \
	# cf https://pyinstaller.org/en/stable/spec-files.html#adding-files-to-the-bundle once you need dlls

# runs the single executable
run_dist:
	./dist/entrypoint

# builds ubuntu docker image
build_docker:
	docker build -t fiab:ubuntu .

# runs ubuntu docker image
run_docker:
	docker run -p 8000:8000 -p 8002:8002 --rm -it fiab:ubuntu

# deletes temporary files, build files, caches
clean:
	find . -name '*.egg-info' -exec rm -fr {} +
	find . -name '__pycache__' -exec rm -fr {} +
	rm -rf build dist
	rm entrypoint.spec # NOTE we may want to actually preserve this, presumably after `dist` refactor. Don't forget to remove from .gitignore then

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
	uv pip install pre-commit
	pre-commit install

# TODO checksum of requirements, store file inside venv, run pip --upgrade if change detected as a dependency task for `val`
# TODO consider pre-commit install as a separate action

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
	pyinstaller \
		--collect-submodules=forecastbox \
		--add-data "src/forecastbox/web_ui/static/*html:forecastbox/web_ui/static" \
		-F ./src/forecastbox/standalone/entrypoint.py
	# cf https://pyinstaller.org/en/stable/spec-files.html#adding-files-to-the-bundle once you need dlls

# runs the single executable
run_dist:
	./dist/entrypoint

# deletes temporary files, build files, caches
clean:
	rm -rf build dist
	rm entrypoint.spec # NOTE we may want to actually preserve this, presumably after `dist` refactor. Don't forget to remove from .gitignore then
	# TODO clean pycache and pyc

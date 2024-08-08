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

# runs validation suite: mypy, tests
val:
	mypy src --ignore-missing-imports
	mypy tests --ignore-missing-imports
	pytest tests

run_webui:
	fastapi dev src/forecastbox/web_ui/server.py

run_venv:
	python -m forecastbox.standalone.entrypoint

dist:
	pyinstaller --collect-submodules=forecastbox -F ./src/forecastbox/standalone/entrypoint.py
	# TODO include static

run_dist:
	./dist/entrypoint

clean:
	rm -rf build dist
	# TODO clean pycache and pyc

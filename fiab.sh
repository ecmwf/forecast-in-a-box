#!/bin/bash
set -ex
set -o pipefail

FIAB_ROOT="$HOME/.fiab"
check() {
	if [ -z "$(which curl || :)" ] ; then
		echo "command 'curl' not found, please install"
		exit 1
	fi
	mkdir -p "$FIAB_ROOT"
}

maybeInstallUv() {
	# checks whether uv binary exists on the system, exports UV_PATH to hold the binary's path
	if [ -n "$(which uv || :)" ] ; then
		echo "'uv' found, using that"
	elif [ -n "$UV_PATH" ] ; then
		# NOTE consider checking UV_PATH first over `which uv`
		if [ -x "$UV_PATH" ] ; then
			echo "using 'uv' on $UV_PATH"
		else
			echo "'UV_PATH' provided but does not point to an executable: $UV_PATH"
			exit 1
		fi
		export PATH="$UV_PATH:$PATH"
	else
		curl -LsSf https://astral.sh/uv/install.sh | sh
		# TODO install to custom directory instead?
		export PATH="$HOME/.cargo/bin:$PATH" # TODO more reliable
	fi
}

maybeInstallPython() {
	# checks whether py3.11 is present on the system, uv-installs if not, exports UV_PYTHON to hold the binary's path
	MAYBE_PYTHON="$(uv python list | grep python3.11 | sed 's/ \+/;/g' | cut -f 2 -d ';' || :)"
	if [ -z "$MAYBE_PYTHON" ] ; then
		uv python install 3.11 # TODO install to custom directory instead?
		export UV_PY="$(uv python list | grep python3.11 | sed 's/ \+/;/g' | cut -f 2 -d ';')"
	else
		export UV_PY="$MAYBE_PYTHON"
	fi
}

VENV="${FIAB_ROOT}/venv"
FIAB_WHEEL="./forecast_in_a_box-0.0.1-py3-none-any.whl" # TODO replace once on pypi
maybeCreateVenv() {
	# checks whether the correct venv exists, installing via uv if not, and source-activates
	if [ -d "$VENV" ] ; then
		# TODO check packages
		source "${VENV}/bin/activate" # or export the paths?
	else
		uv venv -p "$UV_PY" "$VENV"
		source "${VENV}/bin/activate" # or export the paths?
		uv pip install "$FIAB_WHEEL"
	fi
}

check
maybeInstallUv
maybeInstallPython
maybeCreateVenv

python -m forecastbox.standalone.entrypoint

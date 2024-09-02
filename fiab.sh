#!/bin/bash
set -e
set -o pipefail

usage() {
    cat <<EOF
fiab.sh

The self-bootstrapping installer for Forecast in a Box

This script:
1. checks for the 'uv' binary on the system, and if missing downloads into fiab
   root directory (~/.fiab)
2. checks for a python 3.11 interpreter, and if missing installs it
3. checks for a venv in fiab root directory, and if missing creates it
   and installs the fiab wheel in there from pypi
4. executes the user's command

There are currently three user's command supported:
- regular (no extra arguments) -- launches the fiab standalone regime, with
  frontend, controller and worker all running on the user's host
- warmup ('fiab.sh --warmup') populates a dedicated cache with all python
  dependencies for all tasks, so that later runs can be done offline
- offline ('fiab.sh --offline') is as regular mode, except that no internet
  connection is assumed. There must have been a '--warmup' run before

For the offline regime, it is assumed that the user runs the '--warmup' on
an internet-connected host, packages the fiab root directory and ships it to
a host without general internet connection, where it can then be executed in
the offline mode. But doing the '--warmup' and then '--offline' on the same host
is supported as well.
EOF
}


FIAB_ROOT="$HOME/.fiab"
check() {
	if [ -z "$(which curl || :)" ] ; then
		echo "command 'curl' not found, please install"
		exit 1
	fi
	mkdir -p "$FIAB_ROOT"
	mkdir -p "$FIAB_ROOT/uvcache"
}

maybeInstallUv() {
	# checks whether uv binary exists on the system, exports UV_PATH to hold the binary's path
	if [ -n "$UV_PATH" ] ; then
		if [ -x "$UV_PATH" ] ; then
			echo "using 'uv' on $UV_PATH"
		else
			echo "'UV_PATH' provided but does not point to an executable: $UV_PATH"
			exit 1
		fi
		export PATH="$UV_PATH:$PATH"
	elif [ -d "$FIAB_ROOT/uvdir" ] ; then
		echo "using 'uv' in $FIAB_ROOT/uvdir"
		export PATH="$FIAB_ROOT/uvdir/bin:$PATH"
	elif [ -n "$(which uv || :)" ] ; then
		echo "'uv' found, using that"
	else
		curl -LsSf https://astral.sh/uv/install.sh > "$FIAB_ROOT/uvinstaller.sh"
		CARGO_DIST_FORCE_INSTALL_DIR="$FIAB_ROOT/uvdir" sh "$FIAB_ROOT/uvinstaller.sh"
		export PATH="$FIAB_ROOT/uvdir/bin:$PATH"
	fi
}

maybeInstallPython() {
	# checks whether py3.11 is present on the system, uv-installs if not, exports UV_PYTHON to hold the binary's path
	MAYBE_PYTHON="$(uv python list | grep python3.11 | sed 's/ \+/;/g' | cut -f 2 -d ';' | head -n 1 || :)"
	if [ -z "$MAYBE_PYTHON" ] ; then
		uv python install 3.11 # TODO install to custom directory instead?
		export UV_PY="$(uv python list | grep python3.11 | sed 's/ \+/;/g' | cut -f 2 -d ';' | head -n 1)"
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

ENTRYPOINT=forecastbox.standalone.entrypoint
for arg in "$@"; do
	case "$arg" in
		"--help")
			usage
			exit 0
			;;
		"--warmup")
			export FIAB_CACHE="${FIAB_ROOT}/uvcache"
			ENTRYPOINT=forecastbox.standalone.warmup
			;;
		"--offline")
			export FIAB_CACHE="${FIAB_ROOT}/uvcache"
			export FIAB_OFFLINE=YES
			;;
	esac
done

check
maybeInstallUv
maybeInstallPython
maybeCreateVenv

# NOTE we generally dont set FIAB_CACHE since we want to utilize system cache. For the `offline` regime we dont rely
# on it since we assume it was populated by `warmup` before. Similarly, we dont use system cache for `warmup` because
# regular usage is good enough for warming that up
python -m $ENTRYPOINT

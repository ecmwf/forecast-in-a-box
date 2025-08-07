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
4. checks for a yarn install, and if missing installs it
4. executes the user's command

There are currently three user's command supported:
- regular (no extra arguments) -- launches the fiab standalone regime, with
  frontend, controller and worker all running on the user's host
- warmup ('fiab.sh --warmup') populates a dedicated cache with all python
  dependencies for all tasks, so that later runs can be done offline
- offline ('fiab.sh --offline') is as regular mode, except that no internet
  connection is assumed. There must have been a '--warmup' run before

EOF
}


export FIAB_ROOT=${FIAB_ROOT:-"$HOME/.fiab"}
check() {
	if [ -z "$(which curl || :)" ] ; then
		echo "command 'curl' not found, please install"
		exit 1
	fi
	mkdir -p "$FIAB_ROOT"
	mkdir -p "$FIAB_ROOT/uvcache" "$FIAB_ROOT/data_dir"
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
		export PATH="$FIAB_ROOT/uvdir:$PATH"
	elif [ -n "$(which uv || :)" ] ; then
		echo "'uv' found, using that"
	else
		curl -LsSf https://astral.sh/uv/install.sh > "$FIAB_ROOT/uvinstaller.sh"
		CARGO_DIST_FORCE_INSTALL_DIR="$FIAB_ROOT/uvdir" sh "$FIAB_ROOT/uvinstaller.sh"
		export PATH="$FIAB_ROOT/uvdir:$PATH"
	fi
}

maybeInstallPython() {
	# checks whether py3.11 is present on the system, uv-installs if not, exports UV_PYTHON to hold the binary's path
	# MAYBE_PYTHON="$(uv python list | grep python3.11 | sed 's/ \+/;/g' | cut -f 2 -d ';' | head -n 1 || :)"
    # NOTE somehow this regexp isn't portable, but we dont really need the full binary path
    MAYBE_PYTHON="$(uv python list | grep python3.11 || :)"
	if [ -z "$MAYBE_PYTHON" ] ; then
		uv python install 3.11 # TODO install to fiab home instead?
	fi
    # export UV_PY="$MAYBE_PYTHON"
    export UV_PY="python3.11"
}

VENV="${FIAB_ROOT}/venv"
maybeCreateVenv() {
	# checks whether the correct venv exists, installing via uv if not, and source-activates
	if [ -d "$VENV" ] ; then
		# TODO check packages
		source "${VENV}/bin/activate" # or export the paths?
	else
		uv venv -p "$UV_PY" "$VENV"
		source "${VENV}/bin/activate" # or export the paths?
	fi

    if [ "$FIAB_DEV" == 'yea' ] ; then
        export EARTHKIT_DATA_CACHE_POLICY=user # TODO use this in both regimes, but manage it!
        uv pip install --prerelease=allow --upgrade -e .[test]
    else
        uv pip install --prerelease=allow --upgrade pproc@git+https://github.com/ecmwf/pproc earthkit-workflows-pproc@git+https://github.com/ecmwf/earthkit-workflows-pproc 'git+https://github.com/ecmwf/anemoi-plugins-ecmwf#subdirectory=inference[opendata]' 'forecast-in-a-box[plots,webmars,test]>=0.2.2' # TODO remove prerelease once bin wheels stable, remove pproc and ekw-pproc once published
        export fiab__auth__passthrough=True # NOTE we dont passthrough in `dev` mode as we use it to run strict tests
    fi
}

# override used for eg running `pytest` instead
ENTRYPOINT=${ENTRYPOINT:-forecastbox.standalone.entrypoint}

for arg in "$@"; do
	case "$arg" in
		"--help")
			usage
			exit 0
			;;
		"--warmup")
			export FIAB_CACHE="${FIAB_ROOT}/uvcache"
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

# to allow forks on Macos, cf eg https://github.com/rq/rq/issues/1418
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
python -m $ENTRYPOINT

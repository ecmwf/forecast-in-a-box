#!/bin/bash
set -e
set -o pipefail

usage() {
    cat <<EOF
fiab.sh

The self-bootstrapping installer for Forecast in a Box

This script by default:
1. checks for the 'uv' binary on the system, and if missing downloads into fiab
   root directory (~/.fiab)
2. checks for a python interpreter of desired version, and if missing installs
3. checks for presence of pylock.toml, and if missing, downloads the latest from
   fiab github, similarly for default config.toml
4. checks for a venv in fiab root directory, and if missing creates it
   and installs the fiab package and its pylock-requirements in there from pypi
5. runs the fiab itself, launching a web browser window by default

There are other commands available:
- warmup -- executes just the uv/python/pylock/venv checks, but does not
  launch fiab itself
- service -- as the regular run, but assumed to be executed by the systemd
  at the system start time
- full-reinstall -- deletes the ~/.fiab and replaces itself with the most
  recent launcher

There are many configuration options and tweaks -- inspect the code for the full
listing.
EOF
}


export FIAB_ROOT=${FIAB_ROOT:-"$HOME/.fiab"}
# to allow forks on Macos, cf eg https://github.com/rq/rq/issues/1418
# export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES # disabled because we switched to spawn anyway
export EARTHKIT_DATA_CACHE_POLICY=${EARTHKIT_DATA_CACHE_POLICY:-"user"}
export EARTHKIT_DATA_MAXIMUM_CACHE_SIZE=${EARTHKIT_DATA_MAXIMUM_CACHE_SIZE:-"50G"}
FIAB_PY_VERSION=${FIAB_PY_VERSION:-"3.12.7"}

# TODO bake in self-upgrade regime, similarly to how uv cache is pruned

check() {
	if [ -z "$(which curl || :)" ] ; then
		>&2 echo "command 'curl' not found, please install"
		exit 1
	fi
	mkdir -p "$FIAB_ROOT"
	mkdir -p "$FIAB_ROOT/data_dir"
}

maybeInstallUv() {
	# checks whether uv binary exists on the system, exports UV_PATH to hold the binary's path
	if [ -n "$UV_PATH" ] ; then
		if [ -x "$UV_PATH" ] ; then
			>&2 echo "using 'uv' on $UV_PATH"
		else
			>&2 echo "'UV_PATH' provided but does not point to an executable: $UV_PATH"
			exit 1
		fi
		export PATH="$UV_PATH:$PATH"
	elif [ -d "$FIAB_ROOT/uvdir" ] ; then
		>&2 echo "using 'uv' in $FIAB_ROOT/uvdir"
		export PATH="$FIAB_ROOT/uvdir:$PATH"
	elif [ -n "$(which uv || :)" ] ; then
		>&2 echo "'uv' found, using that"
	else
		curl -LsSf https://astral.sh/uv/install.sh > "$FIAB_ROOT/uvinstaller.sh"
		CARGO_DIST_FORCE_INSTALL_DIR="$FIAB_ROOT/uvdir" sh "$FIAB_ROOT/uvinstaller.sh"
		export PATH="$FIAB_ROOT/uvdir:$PATH"
	fi
}

maybeInstallPython() {
	# checks whether FIAB_PY_VERSION is present on the system, uv-installs if not, exports UV_PYTHON to hold the binary's path
	# MAYBE_PYTHON="$(uv python list | grep python"$FIAB_PY_VERSION" | sed 's/ \+/;/g' | cut -f 2 -d ';' | head -n 1 || :)"
    # NOTE somehow this regexp isn't portable, but we dont really need the full binary path
    MAYBE_PYTHON="$(uv python list | grep python"$FIAB_PY_VERSION" || :)"
	if [ -z "$MAYBE_PYTHON" ] ; then
		uv python install --python-preference only-managed "$FIAB_PY_VERSION"
	fi
    # export UV_PY="$MAYBE_PYTHON"
    export UV_PY="python$FIAB_PY_VERSION"
}

getMostRecentRelease() {
    repo=ecmwf/forecast-in-a-box
    releases_json=$(curl --silent "https://api.github.com/repos/$repo/releases?per_page=1")
    get_releases_status=$?
    if [ $get_releases_status -ne 0 ] ; then
        >&2 echo "failed to get most recent fiab release: $get_releases_status, crashing!"
        exit 1
    fi
    most_recent=$(echo $releases_json  | sed 's/.*tag\/\([^"]*\).*/\1/')
    echo $most_recent
}

LOCK="${FIAB_ROOT}/pylock.toml"
FIAB_GITHUB_FROM="${FIAB_GITHUB_FROM:-tags}" # when we want to install from a specific branch, we set this to heads & set FIAB_RELEASE to that branch
maybeDownloadLock() {
    selectedRelease=$1
    # checks whether requirements is present at fiab root, and downloads if not
    if [ ! -f $LOCK ] ; then
        >&2 echo "not found uv.lock in $LOCK, downloading"
        >&2 echo "will download uv lock for release $selectedRelease"
        lock_url=https://raw.githubusercontent.com/ecmwf/forecast-in-a-box/refs/$FIAB_GITHUB_FROM/$selectedRelease/install/pylock.toml
		curl -LsSf $lock_url > "$LOCK"
        >&2 echo "$(date +%s):$(echo $selectedRelease | tr -d 'v')" > $LOCK.timestamp
    fi
}

maybeGetDefaultConfig() {
    selectedRelease=$1
    if [ ! -f "${FIAB_ROOT}/config.toml" ] ; then
        >&2 echo "no config file, downloading a default for release $selectedRelease"
        config_url=https://raw.githubusercontent.com/ecmwf/forecast-in-a-box/refs/$FIAB_GITHUB_FROM/$selectedRelease/install/config.toml
		curl -LsSf $config_url > "${FIAB_ROOT}/config.toml"
    fi
}

VENV="${FIAB_ROOT}/venv"

updateVenv() {
    FIAB_VERSION=$(cat $LOCK.timestamp | cut -f 2 -d : )
    >&2 echo "using fiab version $FIAB_VERSION"
    uv pip install -r $LOCK
    uv pip install "forecast-in-a-box==$FIAB_VERSION"
    touch $VENV.timestamp
}

maybeCreateVenv() {
	# checks whether the correct venv exists, installing via uv if not, and source-activates
	if [ -d "$VENV" ] ; then
		source "${VENV}/bin/activate"
        if [ ! -f $VENV.timestamp ] ; then
            updateVenv
        elif [ $VENV.timestamp -ot $LOCK.timestamp ] ; then
            updateVenv
        fi
	else
		uv venv -p "$UV_PY" --python-preference only-managed "$VENV"
		source "${VENV}/bin/activate"
        updateVenv
	fi

}

maybePruneUvCache() {
    # NOTE we install a lot, so we best prune uv cache from time to time. This is a system-wide effect, but presumably not an undesired one
    PRUNETS=$FIAB_ROOT/uvcache.prunetimestamp
    if [ -f "$PRUNETS" ] ; then
        if find "$PRUNETS" -mtime +30 | grep "$PRUNETS" ; then
            >&2 echo "uv cache pruned more than 30 days ago: pruning"
            uv cache prune
            touch "$PRUNETS"
        fi
    else
        touch "$PRUNETS"
    fi
}

ensureEnvironment() {
    check
    maybeInstallUv
    maybeInstallPython
    selectedRelease=${FIAB_RELEASE:-$(getMostRecentRelease)}
    maybeDownloadLock $selectedRelease
    maybeGetDefaultConfig $selectedRelease
    maybeCreateVenv
    maybePruneUvCache
}

# override used for eg running `pytest` instead
COMMAND="${1:-run}"
case "$COMMAND" in
    "help")
        usage
        ;;
    "warmup")
        # TODO see the `--offline` for how this should be extended. In the meantime we leave this
        # option in place just to run the base venv install and update
        ensureEnvironment
        ;;
    "offline")
        # TODO we used to have FIAB_CACHE and FIAB_OFFLINE env vars in place, with the assumption
        # that running in warmup mode would pre-install all job dependencies. This got broken
        # in the recent development and there is no readily accessible iteration through supported
        # jobs. We should fix it eventually
        >&2 echo "offline mode not supported now"
        exit 1
        ;;
    "service")
        ensureEnvironment
        python -m forecastbox.standalone.service
        ;;
    "full-reinstall")
        uv cache prune
        rm -rf $FIAB_ROOT
        selectedRelease=${FIAB_RELEASE:-$(getMostRecentRelease)}
        >&2 echo "Will download launcher for release $selectedRelease"
        launcherPath=$(readlink -f "$0")
        launcherUrl=https://raw.githubusercontent.com/ecmwf/forecast-in-a-box/refs/$FIAB_GITHUB_FROM/$selectedRelease/scripts/fiab.sh
		curl -LsSf $launcherUrl > "$launcherPath"
        >&2 echo "The launcher has been updated in-place at $launcherPath. Run it again to start"
        ;;
    "run")
        ensureEnvironment
        python -m forecastbox.standalone.entrypoint
        ;;
    *)
        >&2 echo "unknown command $COMMAND"
        exit 1
esac


if [ -n "$ENTRYPOINT" ] ; then
    python -m $ENTRYPOINT
fi

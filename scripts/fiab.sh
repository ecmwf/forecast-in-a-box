#!/bin/bash
set -e
set -o pipefail

# NOTE when making changes here, make sure you consult domain/admin/__init__.py, as some logic is shared with that file
# Namely, it is capable of updating the lock and the release marker. There are additionally subtle couplings with
# - utility/config.py
# - entrypoint/main.py, entrypoint/warmup.py, entrypoint/bootstrap/service.py
# NOTE if you are trying to understand this -- first read the case-switch at the very end, and then the
# ensureRegularRun, doUpgrade and doReinstall functions. The rest of this file is just auxiliary functions

# NOTE testing an unreleased branch via this script is currently not supported -- only released tags can be installed.
# You can still test against a locally built wheel by setting FIAB_PIP_EXTRA='--no-cache --find-links <dir with wheel>'
# and FIAB_ROOT=<some tmp dir>, but the lock and the version are always those of a released tag.

# TODO move from .fiab/<everything> to .fiab/<version> so that upgrades and reinstalls can be rolled back, and uv survives reinstalls

usage() {
    cat <<EOF
fiab.sh

The self-bootstrapping installer for Forecast in a Box

Usage: fiab.sh [run|warmup [version]|service|upgrade [version]|reinstall [version]|help]

The regular run (no command, or 'run'):
1. checks for the 'uv' binary on the system, and if missing downloads into fiab
   root directory (~/.fiab)
2. checks for a python interpreter of desired version, and if missing installs
3. determines the release -- the one already installed, or the most recent one
   on github if nothing is installed yet. The regular run never changes the
   release of an existing installation
4. checks for presence of pylock.toml, and if missing, downloads the one of the
   release from fiab github, similarly for default config.toml
5. checks for a venv in fiab root directory, and if missing creates it
   and installs the fiab package and its pylock-requirements in there from pypi
6. runs the fiab itself, launching a web browser window by default

There are other commands available:
- warmup [version] -- executes the same checks as the regular run and installs
  plugins, but does not launch fiab itself. The plugins for installation are
  specified in the corresponding config.toml. If version (like v1.2.3) is given,
  that release is installed -- allowed only if nothing is installed yet
- service -- as the regular run, but assumed to be executed by the systemd
  at the system start time
- upgrade [version] -- changes the installed release to the given one (like
  v1.2.3), or the most recent one if not given. Only upgrades within the same
  major version are currently supported. Does not launch fiab, and should not be
  executed while fiab is running
- reinstall [version] -- deletes the ~/.fiab and installs the given release, or
  prompts for current or latest if not given (defaulting to current when not
  interactive). Does not launch fiab, and should not be executed while fiab is
  running

Environment variables:
- FIAB_ROOT -- the installation directory, default ~/.fiab
- FIAB_PY_VERSION -- the python version to use
- FIAB_PIP_EXTRA -- extra arguments for installing the forecast-in-a-box wheel
- UV_PATH -- path to the uv binary to use
EOF
}

for removedVar in FIAB_RELEASE FIAB_GITHUB_FROM FIAB_CUSTOM_VERSION ; do
    if [ -n "${!removedVar+x}" ] ; then
        >&2 echo "envvar $removedVar is no longer supported -- use the 'upgrade', 'reinstall' or 'warmup' commands with an explicit version instead"
        exit 1
    fi
done

export FIAB_ROOT=${FIAB_ROOT:-"$HOME/.fiab"}
# to allow forks on Macos, cf eg https://github.com/rq/rq/issues/1418
# export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES # disabled because we switched to spawn anyway
export EARTHKIT_DATA_CACHE_POLICY=${EARTHKIT_DATA_CACHE_POLICY:-"user"}
export EARTHKIT_DATA_MAXIMUM_CACHE_SIZE=${EARTHKIT_DATA_MAXIMUM_CACHE_SIZE:-"50G"}
FIAB_PY_VERSION=${FIAB_PY_VERSION:-"3.12.7"}
FIAB_FIRSTRUN_MARKER="${FIAB_ROOT}/firstrun"
export FIAB_RELEASE_MARKER="${FIAB_ROOT}/release"
LOCK="${FIAB_ROOT}/pylock.toml"
VENV="${FIAB_ROOT}/venv"
FIAB_PIP_EXTRA="${FIAB_PIP_EXTRA:-""}" # eg when we install from test pypi. Applies *only* to the forecastbox wheel itself! And put there the full `-i http://testpypi`
GITHUB_REPO="ecmwf/forecast-in-a-box"

### tools

check() {
	if [ -z "$(which curl || :)" ] ; then
		>&2 echo "command 'curl' not found, please install"
		exit 1
	fi
    mkdir -p "$FIAB_ROOT"
}

checkFirstRun() {
    # NOTE called only for the commands which launch python, so that the marker is not created by upgrade/reinstall
    if [ -f "$FIAB_FIRSTRUN_MARKER" ] ; then
        >&2 echo ".fiab firstrun found, assuming this is not first run"
        export FIAB_FIRSTRUN="false"
    else
        >&2 echo ".fiab firstrun not found, assuming this is first run"
        export FIAB_FIRSTRUN="true"
        touch "$FIAB_FIRSTRUN_MARKER" # TODO create this in the python command instead!
    fi
}

maybeInstallUv() {
	# checks whether uv binary exists on the system, puts it on PATH if needed
	if [ -n "${UV_PATH:-}" ] ; then
		if [ -x "$UV_PATH" ] ; then
			>&2 echo "using 'uv' on $UV_PATH"
		else
			>&2 echo "'UV_PATH' provided but does not point to an executable: $UV_PATH"
			exit 1
		fi
		PATH="$(dirname "$UV_PATH"):$PATH"
		export PATH
	elif [ -x "${FIAB_ROOT}/uvdir/uv" ] ; then
		>&2 echo "using 'uv' in ${FIAB_ROOT}/uvdir"
		export PATH="${FIAB_ROOT}/uvdir:$PATH"
	elif [ -n "$(which uv || :)" ] ; then
		>&2 echo "'uv' found, using that"
	else
		curl -fLsS https://astral.sh/uv/install.sh > "${FIAB_ROOT}/uvinstaller.sh"
		CARGO_DIST_FORCE_INSTALL_DIR="${FIAB_ROOT}/uvdir" sh "${FIAB_ROOT}/uvinstaller.sh"
		export PATH="${FIAB_ROOT}/uvdir:$PATH"
	fi
}

maybeInstallPython() {
	# checks whether FIAB_PY_VERSION is present on the system, uv-installs if not, exports UV_PY to hold the interpreter name
    # NOTE we dont need the full binary path, and extracting it from `uv python list` is not portable
    MAYBE_PYTHON="$(uv python list | grep "python${FIAB_PY_VERSION}" || :)"
	if [ -z "$MAYBE_PYTHON" ] ; then
		uv python install --python-preference only-managed "$FIAB_PY_VERSION"
	fi
    export UV_PY="python${FIAB_PY_VERSION}"
}

ensureTools() {
    check
    maybeInstallUv
    maybeInstallPython
}

### releases

isReleaseTag() {
    # a release tag is like v1.2.3
    [[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

getMostRecentRelease() {
    local releaseJson
    local mostRecent
    if ! releaseJson=$(curl -fsS "https://api.github.com/repos/${GITHUB_REPO}/releases/latest") ; then
        >&2 echo "failed to get most recent fiab release from github, crashing!"
        exit 1
    fi
    mostRecent=$(echo "$releaseJson" | grep '"tag_name"' | head -n 1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
    if ! isReleaseTag "$mostRecent" ; then
        >&2 echo "most recent fiab release '$mostRecent' does not look like a release tag, crashing!"
        exit 1
    fi
    echo "$mostRecent"
}

checkReleaseValid() {
    # exits if the given release is not of the vX.Y.Z format or not a release on github
    release=$1
    if ! isReleaseTag "$release" ; then
        >&2 echo "'$release' is not a valid release tag -- expected format is like v1.2.3"
        exit 1
    fi
    if ! curl -fsS -o /dev/null "https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${release}" ; then
        >&2 echo "'$release' is not a release of ${GITHUB_REPO} on github (or github is unreachable)"
        exit 1
    fi
}

markRelease() {
    echo "$1" > "$FIAB_RELEASE_MARKER"
}

getMarkedRelease() {
    # prints the marked release if any, normalized to the vX.Y.Z format
    if [ -f "$FIAB_RELEASE_MARKER" ] ; then
        markedRelease=$(cat "$FIAB_RELEASE_MARKER")
        if [ -n "$markedRelease" ] && [[ "$markedRelease" != v* ]] ; then
            # NOTE older versions of the backend admin api wrote the marker without the prefix
            markedRelease="v${markedRelease}"
        fi
        echo "$markedRelease"
    fi
}

selectRelease() {
    # picks the marked release, or the most recent one which is then marked -- the absence of a marker
    # means nothing has been installed yet, in which case the launcher is assumed to be up-to-date
    markedRelease=$(getMarkedRelease)
    if [ -n "$markedRelease" ] ; then
        >&2 echo "Release specified by mark: $markedRelease"
        echo "$markedRelease"
    else
        >&2 echo "No release marked, determining most recent release"
        mostRecent=$(getMostRecentRelease) || exit 1
        markRelease "$mostRecent"
        echo "$mostRecent"
    fi
}

compareReleases() {
    # prints -1, 0 or 1 when the first release is lower, equal, or greater than the second, comparing numerically
    local a b
    IFS=. read -r -a a <<< "${1#v}"
    IFS=. read -r -a b <<< "${2#v}"
    for i in 0 1 2 ; do
        if [ "${a[$i]}" -lt "${b[$i]}" ] ; then
            echo -1
            return
        elif [ "${a[$i]}" -gt "${b[$i]}" ] ; then
            echo 1
            return
        fi
    done
    echo 0
}

### environment

maybeDownloadLock() {
    selectedRelease=$1
    # checks whether the lock is present at fiab root, and downloads if not
    if [ ! -f "$LOCK" ] ; then
        lockUrl="https://raw.githubusercontent.com/${GITHUB_REPO}/refs/tags/${selectedRelease}/install/pylock.toml"
        >&2 echo "not found pylock in $LOCK, will download for release $selectedRelease from $lockUrl"
        curl -fLsS "$lockUrl" > "${LOCK}.download"
        # NOTE the timestamp holds the version without the 'v' prefix. It is written before the lock itself is put
        # in place so that an interruption results in a re-download rather than an inconsistent lock
        echo "$(date +%s):${selectedRelease#v}" > "${LOCK}.timestamp"
        mv "${LOCK}.download" "$LOCK"
    fi
}

maybeGetDefaultConfig() {
    selectedRelease=$1
    if [ ! -f "${FIAB_ROOT}/config.toml" ] ; then
        configUrl="https://raw.githubusercontent.com/${GITHUB_REPO}/refs/tags/${selectedRelease}/install/config.toml"
        >&2 echo "no config file, downloading a default for release $selectedRelease from $configUrl"
		curl -fLsS "$configUrl" > "${FIAB_ROOT}/config.toml.download"
        mv "${FIAB_ROOT}/config.toml.download" "${FIAB_ROOT}/config.toml"
    fi
    # TODO we should separate default and user config, and always download the default config when the release changes.
    # However, we currently purposefully keep the default config empty and have defaults in code, meaning this is not urgent
}

updateVenv() {
    FIAB_VERSION=$(cut -f 2 -d : < "${LOCK}.timestamp")
    >&2 echo "using fiab version $FIAB_VERSION"
    # NOTE deliberately not a strict sync -- that would remove the plugins installed in the venv
    uv pip install -r "$LOCK"
    read -r -a pipExtra <<< "$FIAB_PIP_EXTRA"
    uv pip install "${pipExtra[@]}" "forecast-in-a-box==$FIAB_VERSION"
    touch "${VENV}.timestamp"
}

maybeCreateVenv() {
	# checks whether the correct venv exists, installing via uv if not, and source-activates
	if [ -d "$VENV" ] ; then
		# shellcheck disable=SC1091
		source "${VENV}/bin/activate"
        if [ ! -f "${VENV}.timestamp" ] ; then
            updateVenv
        elif [ "${VENV}.timestamp" -ot "${LOCK}.timestamp" ] ; then
            updateVenv
        fi
	else
		uv venv -p "$UV_PY" --python-preference only-managed "$VENV"
		# shellcheck disable=SC1091
		source "${VENV}/bin/activate"
        updateVenv
	fi
}

maybePruneUvCache() {
    # NOTE we install a lot, so we best prune uv cache from time to time. This is a system-wide effect, but presumably not an undesired one
    PRUNETS="${FIAB_ROOT}/uvcache.prunetimestamp"
    if [ -f "$PRUNETS" ] ; then
        if find "$PRUNETS" -mtime +30 | grep -q "$PRUNETS" ; then
            >&2 echo "uv cache pruned more than 30 days ago: pruning"
            uv cache prune
            touch "$PRUNETS"
        fi
    else
        touch "$PRUNETS"
    fi
}

ensureEnv() {
    selectedRelease=$1
    mkdir -p "${FIAB_ROOT}/data_dir"
    maybeDownloadLock "$selectedRelease"
    maybeGetDefaultConfig "$selectedRelease"
    maybeCreateVenv
    maybePruneUvCache
}

replaceLauncher() {
    # replaces this script with the one of the given release. Does not mark the release
    selectedRelease=$1
    >&2 echo "Will download launcher for release $selectedRelease"
    launcherPath=$(readlink -f "$0")
    launcherUrl="https://raw.githubusercontent.com/${GITHUB_REPO}/refs/tags/${selectedRelease}/scripts/fiab.sh"
    # NOTE the tmp file is next to the launcher so that the mv is atomic
    nextLauncher=$(mktemp "${launcherPath}.next.XXXXXX")
    if ! curl -fLsS "$launcherUrl" > "$nextLauncher" ; then
        rm -f "$nextLauncher"
        >&2 echo "Failed to download launcher from $launcherUrl"
        exit 1
    fi
    if [ "$(head -n 1 "$nextLauncher")" == "#!/bin/bash" ] ; then
        chmod 755 "$nextLauncher" # TODO copy the properties of the original launcher instead!
        mv "$nextLauncher" "$launcherPath"
        >&2 echo "The launcher has been updated in-place at $launcherPath"
    else
        >&2 echo "Downloaded file does not look like a launcher script, refusing to replace!"
        >&2 head -c 200 "$nextLauncher"
        rm -f "$nextLauncher"
        exit 1
    fi
}

### commands

ensureRegularRun() {
    ensureTools
    checkFirstRun
    selectedRelease=$(selectRelease) || exit 1
    >&2 echo "Selected release is $selectedRelease"
    ensureEnv "$selectedRelease"
}

determineUpgradeScope() {
    # prints one of fresh, downgrade, major, minor -- the minor includes patch and same-version changes
    currentRelease=$1
    targetRelease=$2
    if [ -z "$currentRelease" ] ; then
        echo fresh
        return
    fi
    if ! isReleaseTag "$currentRelease" ; then
        >&2 echo "installed release '$currentRelease' is not a valid release tag, cannot upgrade -- do a reinstall instead"
        exit 1
    fi
    if [ "$(compareReleases "$currentRelease" "$targetRelease")" == "1" ] ; then
        echo downgrade
    elif [ "$(echo "${currentRelease#v}" | cut -f 1 -d .)" -lt "$(echo "${targetRelease#v}" | cut -f 1 -d .)" ] ; then
        echo major
    else
        echo minor
    fi
}

upgradeMinor() {
    targetRelease=$1
    # NOTE the order is chosen for robustness against failures in the middle: the lock is deleted first so that a failure
    # before marking just re-downloads the original lock, and once the marker and launcher are in place, any subsequent
    # run/service/warmup finishes the environment update
    rm -f "$LOCK" "${LOCK}.timestamp"
    markRelease "$targetRelease"
    replaceLauncher "$targetRelease"
    ensureEnv "$targetRelease"
    >&2 echo "Release $targetRelease installed. Run the launcher again (or restart the service) to start"
}

upgradeMajor() {
    # TODO for the proper upgrade:
    # - remove the venv
    # - dump the config
    # - dump the db (plugins, blueprints, glyphs, ...)
    # - preserve the artifacts
    # TODO utilize hardlinks here and in reinstall as well, to allow for 'rollback' -- have .fiab_{version} directories, and have .fiab hardlink-point at one of them
    >&2 echo "upgrade across major versions is not implemented yet, do a reinstall instead"
    exit 1
}

doUpgrade() {
    ensureTools
    if [ -n "${1:-}" ] ; then
        checkReleaseValid "$1"
        targetRelease=$1
    else
        targetRelease=$(getMostRecentRelease) || exit 1
    fi
    # NOTE we dont use selectRelease here because with nothing installed, there is nothing to compare against
    currentRelease=$(getMarkedRelease)
    scope=$(determineUpgradeScope "$currentRelease" "$targetRelease") || exit 1
    >&2 echo "Upgrade from '${currentRelease}' to $targetRelease is of scope $scope"
    case "$scope" in
        "downgrade")
            >&2 echo "cannot upgrade from $currentRelease to lower $targetRelease -- do a reinstall instead"
            exit 1
            ;;
        "major")
            upgradeMajor "$targetRelease"
            ;;
        "minor"|"fresh")
            upgradeMinor "$targetRelease"
            ;;
    esac
}

promptReinstallRelease() {
    # prints the release to reinstall to, given the current one
    currentRelease=$1
    if [ -z "$currentRelease" ] ; then
        >&2 echo "No release currently installed, will reinstall to latest"
        getMostRecentRelease
    elif [ ! -t 0 ] ; then
        >&2 echo "Not interactive, will reinstall to current release $currentRelease"
        echo "$currentRelease"
    else
        while true ; do
            if ! read -r -p "Reinstall current ($currentRelease) or latest? [current/latest]: " answer ; then
                >&2 echo "No answer given, aborting"
                exit 1
            fi
            case "$answer" in
                "current")
                    echo "$currentRelease"
                    return
                    ;;
                "latest")
                    getMostRecentRelease
                    return
                    ;;
                *)
                    >&2 echo "Please answer either 'current' or 'latest'"
                    ;;
            esac
        done
    fi
}

doReinstall() {
    ensureTools
    if [ -n "${1:-}" ] ; then
        targetRelease=$1
    else
        targetRelease=$(promptReinstallRelease "$(getMarkedRelease)") || exit 1
    fi
    # NOTE validated even when coming from the marker, so that we fail before deleting anything
    checkReleaseValid "$targetRelease"
    >&2 echo "Will reinstall to release $targetRelease"
    uv cache prune
    rm -rf "${FIAB_ROOT:?}" && mkdir -p "$FIAB_ROOT"
    # NOTE uv may have been in the deleted root, so we ensure the tools again
    ensureTools
    markRelease "$targetRelease"
    replaceLauncher "$targetRelease"
    ensureEnv "$targetRelease"
    >&2 echo "Release $targetRelease reinstalled. Run the launcher again (or restart the service) to start"
}

doWarmup() {
    if [ -n "${1:-}" ] ; then
        ensureTools
        markedRelease=$(getMarkedRelease)
        if [ -n "$markedRelease" ] ; then
            >&2 echo "Release $markedRelease is already installed, refusing to warmup with $1 -- use upgrade or reinstall instead"
            exit 1
        fi
        checkReleaseValid "$1"
        markRelease "$1"
        replaceLauncher "$1"
    fi
    ensureRegularRun
}

ensureMaxArgs() {
    # exits if the command was given more than the allowed number of arguments
    maxArgs=$1
    shift
    if [ "$#" -gt "$maxArgs" ] ; then
        >&2 echo "too many arguments: $*"
        exit 1
    fi
}

COMMAND="${1:-run}"
shift || :
case "$COMMAND" in
    "help")
        usage
        ;;
    "warmup")
        # NOTE the `checkFirstRun` inside `ensureRegularRun` touches the firstrun marker, hence a
        # subsequent `run` will not attempt the default plugin installation again -- the plugin
        # installation is the responsibility of the warmup command itself
        ensureMaxArgs 1 "$@"
        doWarmup "$@"
        python -m forecastbox.entrypoint.warmup
        ;;
    "service")
        ensureMaxArgs 0 "$@"
        ensureRegularRun
        python -m forecastbox.entrypoint.bootstrap.service
        ;;
    "upgrade")
        ensureMaxArgs 1 "$@"
        doUpgrade "$@"
        ;;
    "reinstall")
        ensureMaxArgs 1 "$@"
        doReinstall "$@"
        ;;
    "run")
        ensureMaxArgs 0 "$@"
        ensureRegularRun
        python -m forecastbox.entrypoint.main
        ;;
    *)
        >&2 echo "unknown command $COMMAND"
        usage
        exit 1
esac

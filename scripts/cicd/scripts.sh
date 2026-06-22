#!/bin/bash

function setupBash() {
    # args
    # $1 true => isDebug (set -x), false => no debug prints
    isDebug=$1
    set -euo pipefail
    if [ "$isDebug" = "true" ] ; then
        set -x
    fi
}

function uploadPypi() {
    # args
    # $1 true => testpypi, false => regular pypi
    # $2 <path> => directory/glob where wheels are expected
    # env
    # TWINE_PASSWORD_TEST, TWINE_PASSWORD_PROD
    testpypi=$1
    wheelhouse=$2
    # NOTE we need wheelhouse to glob
    # shellcheck disable=SC2086
    uv run --with twine --no-project twine check $wheelhouse
    if [ "$testpypi" = "true" ] ; then
        TWINE_PASSWORD="$TWINE_PASSWORD_TEST"
        REPOSITORY="--repository testpypi --skip-existing"
    else
        TWINE_PASSWORD="$TWINE_PASSWORD_PROD"
        REPOSITORY=""
    fi
    # NOTE we need wheelhouse to glob, and repository to expand
    # shellcheck disable=SC2086
    TWINE_PASSWORD=$TWINE_PASSWORD uv run --with twine --no-project twine upload --disable-progress-bar --verbose --non-interactive $REPOSITORY $wheelhouse
}

function gitTagAndPush() {
    # args
    # $1 true => testpypi (no tag&push), false => regular pypi (do tag&push)
    # $2 <tag>
    testpypi=$1
    tag=$2
    if [ "$testpypi" = "false" ] ; then
        git tag "$tag"
        git push origin "$tag"
    fi
}

function getLatestTagAndIncrement() {
    # args
    # $1 <tag prefix>
    # behaviour:
    # 1/ queries existing git tags starting with prefix and optionally droping fourth number
    # 2/ finds the num-highest with given prefix (or 0.0.0 if none found)
    # 3/ echo the result including prefix
    #
    tagPref=$1
    LATEST_TAG=$(
      git tag -l "${tagPref}*" \
      | sed -nE 's/^'"$tagPref"'([0-9]+\.[0-9]+\.[0-9]+)(\.[0-9]+)?$/\1/p' \
      | sort -V \
      | tail -n1
    )
    if [[ -z "$LATEST_TAG" ]] ; then LATEST_TAG="${tagPref}0.0.0"; fi

    VERSION_NUMBERS=${LATEST_TAG#"$tagPref"}
    IFS='.' read -r MAJOR MINOR PATCH <<< "$VERSION_NUMBERS"
    NEW_PATCH=$((PATCH + 1))
    echo "${tagPref}${MAJOR}.${MINOR}.${NEW_PATCH}"
}

function validateTag() {
    # args
    # $1 <tag>
    # $2 <expected tag prefix>
    # behaviour -- checks that tag matches prefix and does not exist in git
    tag=$1
    tagPref=$2
    echo "$tag" | grep -Eq '^'"$tagPref"'[0-9]+\.[0-9]+\.[0-9]+$' || {
      echo "expected tag in the form ${tagPref}X.Y.Z" >&2
      exit 1
    }

    isFound=$(git tag | grep '^'"$tag"'$' || : )
    if [[ -n "$isFound" ]] ; then echo "tag $tag already exists in git" ; exit 1 ; fi
}

function tagFromInputOrLatest() {
    # args
    # $1 <inputs.tag>
    # $2 <tagPref>
    # behaviour -- if input tag given, validate, otherwise grep for latest tag and add +1. Echo the result
    input=$1
    tagPref=$2
    if [ -n "$input" ] ; then
      validateTag "$input" "$tagPref"
      echo "$input"
    else
      getLatestTagAndIncrement "$tagPref"
    fi
}

function preparePythonWheelVersion() {
    # args
    # $1 <tag>, may include initial letter prefix and three to four numbers
    # behaviour -- strips prefix and fourth number, exports scm envvar
    tag_full=$1
    tag=$(echo "$tag_full" | sed -nE 's/^[a-zA-Z]*([0-9]+\.[0-9]+\.[0-9]+)(\.[0-9]+)?$/\1/p')
    export SETUPTOOLS_SCM_PRETEND_VERSION=$tag
}

function extractFiabCoreTag() {
    # args
    # $1 <plugin_tag> -- e.g. "p2.3.4" or "p2.3.4.0"
    # behaviour -- derives major version from plugin_tag, finds the latest git tag
    # matching c<major>.*.*, strips to X.Y.Z, and echoes the version string.
    # fails hard if no matching tag exists or plugin_tag is malformed.
    # usage: TAG_FIABCORE=$(extractFiabCoreTag "$TAG")
    local plugin_tag="$1"
    local major
    major=$(echo "$plugin_tag" | sed -nE 's/^[a-zA-Z]*([0-9]+)\.[0-9]+\.[0-9]+(\.[0-9]+)?$/\1/p')
    if [[ -z "$major" ]]; then
        echo "extractFiabCoreTag: cannot derive major version from tag: $plugin_tag" >&2
        exit 1
    fi

    local found
    found=$(
        git tag -l "c${major}.*" \
        | sed -nE 's/^c([0-9]+\.[0-9]+\.[0-9]+)(\.[0-9]+)?$/\1/p' \
        | sort -V \
        | tail -n1
    )

    if [[ -z "$found" ]]; then
        echo "extractFiabCoreTag: no fiab-core tag found for major version $major" >&2
        exit 1
    fi

    echo "$found"
}

function majorFromVersion() {
    # args
    # $1 <version> -- X.Y.Z version string with optional prefix ([a-zA-Z]) and optional fourth number, e.g. "2.1.0" or "v1.2.3.0"
    # behaviour -- echoes the major version integer, e.g. "2"
    # usage: TAG_FIABCORE_MAJ=$(majorFromVersion "$TAG_FIABCORE")
    local version="$1"
    local major
    major=$(echo "$version" | sed -nE 's/^([a-zA-Z]+)?([0-9]+)\.[0-9]+\.[0-9]+(\.[0-9]+)?$/\2/p')
    if [[ -z "$major" ]]; then
        echo "majorFromVersion: cannot extract major from version: $version" >&2
        exit 1
    fi
    echo "$major"
}

function patchFiabCoreDep() {
    # args
    # $1 <major> -- integer major version, e.g. "2"
    # behaviour -- rewrites the fiab-core dependency constraint in pyproject.toml
    # in CWD to "fiab-core>=${major},<${major+1} # SENTINEL".
    # MATCH requires the fiab-core dep to precede the sentinel, so only the
    # actual dependency line is ever modified (other mentions of fiab-core without
    # the sentinel, or with the sentinel before the dep, are not affected).
    # Fails hard if pyproject.toml does not contain exactly one line matching MATCH.
    local major="$1"
    local next_major=$(( major + 1 ))

    local SENTINEL="auto-updateable"
    local MATCH='"fiab-core[^"]*".*'"$SENTINEL"
    local REPLACE_WITH="\"fiab-core>=${major},<${next_major}\", # ${SENTINEL} -- do not remove this comment"

    local count
    count=$(grep -cE "$MATCH" pyproject.toml || true)
    if [[ "$count" -ne 1 ]]; then
        echo "patchFiabCoreDep: expected exactly 1 ${SENTINEL} fiab-core line in pyproject.toml, found $count" >&2
        exit 1
    fi

    # MATCH already encodes both the fiab-core dep and the sentinel (in that order),
    # so a single substitution is sufficient and more precise than a two-stage
    # address+pattern approach.
    sed -i -E "s|${MATCH}.*|${REPLACE_WITH}|" pyproject.toml
}

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
    twine check $wheelhouse
    if [ "$testpypi" = "true" ] ; then
        TWINE_PASSWORD="$TWINE_PASSWORD_TEST"
        REPOSITORY="--repository testpypi --skip-existing"
    else
        TWINE_PASSWORD="$TWINE_PASSWORD_PROD"
        REPOSITORY=""
    fi
    # NOTE we need wheelhouse to glob, and repository to expand
    # shellcheck disable=SC2086
    TWINE_PASSWORD=$TWINE_PASSWORD twine upload --disable-progress-bar --verbose --non-interactive $REPOSITORY $wheelhouse
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

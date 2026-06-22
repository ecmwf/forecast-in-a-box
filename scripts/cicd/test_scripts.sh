#!/usr/bin/env bash
# Test suite for scripts/cicd/scripts.sh
#
# Strategy: prepend scripts/cicd/test_mocks/ to PATH so that external tools
# (git, twine) are intercepted by mock scripts. Mocks record every call to
# $MOCK_CALLS_FILE and return data controlled by environment variables.
#
# Run directly:   bash scripts/cicd/test_scripts.sh
# Run via just:   just val-cicd-scripts

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOCKS_DIR="$SCRIPT_DIR/test_mocks"

# Prepend mocks to PATH so they shadow real git/twine
export PATH="$MOCKS_DIR:$PATH"

# Source the script under test (defines functions, no side effects at source time)
# shellcheck source=scripts/cicd/scripts.sh
source "$SCRIPT_DIR/scripts.sh"

# ---------------------------------------------------------------------------
# Minimal test framework
# ---------------------------------------------------------------------------
TESTS_RUN=0
TESTS_FAILED=0

MOCK_CALLS_FILE=$(mktemp)
export MOCK_CALLS_FILE
trap 'rm -f "$MOCK_CALLS_FILE"' EXIT

_pass() { echo "  PASS: $1"; ((TESTS_RUN++)); }
_fail() { echo "  FAIL: $1 -- $2"; ((TESTS_RUN++)); ((TESTS_FAILED++)); }

assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    if [[ "$expected" == "$actual" ]]; then
        _pass "$desc"
    else
        _fail "$desc" "expected='$expected' actual='$actual'"
    fi
}

assert_contains() {
    local desc="$1" pattern="$2" actual="$3"
    if echo "$actual" | grep -qF -- "$pattern"; then
        _pass "$desc"
    else
        _fail "$desc" "expected to contain '$pattern', got: $actual"
    fi
}

assert_not_contains() {
    local desc="$1" pattern="$2" actual="$3"
    if ! echo "$actual" | grep -qF -- "$pattern"; then
        _pass "$desc"
    else
        _fail "$desc" "expected NOT to contain '$pattern', got: $actual"
    fi
}

# assert_fails <desc> <cmd> [args...]  -- passes if the command exits non-zero
assert_fails() {
    local desc="$1"; shift
    if ( "$@" ) 2>/dev/null; then
        _fail "$desc" "expected command to fail but it succeeded"
    else
        _pass "$desc"
    fi
}

calls_file_contains() { grep -qF "$1" "$MOCK_CALLS_FILE"; }

reset_mocks() {
    : > "$MOCK_CALLS_FILE"
    unset MOCK_GIT_TAGS_LIST 2>/dev/null || true
    unset MOCK_GIT_TAGS_ALL  2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Tests: preparePythonWheelVersion
# ---------------------------------------------------------------------------
test_prepare_python_wheel_version() {
    echo "--- preparePythonWheelVersion ---"

    preparePythonWheelVersion "v1.2.3"
    assert_eq "strips v prefix" "1.2.3" "$SETUPTOOLS_SCM_PRETEND_VERSION"

    preparePythonWheelVersion "v1.2.3.4"
    assert_eq "strips 4th version number" "1.2.3" "$SETUPTOOLS_SCM_PRETEND_VERSION"

    preparePythonWheelVersion "1.2.3"
    assert_eq "no prefix" "1.2.3" "$SETUPTOOLS_SCM_PRETEND_VERSION"

    preparePythonWheelVersion "abc1.2.3"
    assert_eq "multi-char prefix" "1.2.3" "$SETUPTOOLS_SCM_PRETEND_VERSION"

    preparePythonWheelVersion "c1.0.0.4"
    assert_eq "letter prefix with 4-part version" "1.0.0" "$SETUPTOOLS_SCM_PRETEND_VERSION"
}

# ---------------------------------------------------------------------------
# Tests: extractFiabCoreTag
# ---------------------------------------------------------------------------
test_extract_fiab_core_tag() {
    echo "--- extractFiabCoreTag ---"

    reset_mocks
    export MOCK_GIT_TAGS_LIST="c2.0.0"
    result=$(extractFiabCoreTag "p2.3.4")
    assert_eq "echoes fiab-core version" "2.0.0" "$result"

    reset_mocks
    export MOCK_GIT_TAGS_LIST=$'c2.0.0\nc2.1.5\nc2.1.0'
    result=$(extractFiabCoreTag "p2.3.4")
    assert_eq "picks latest cX tag" "2.1.5" "$result"

    reset_mocks
    export MOCK_GIT_TAGS_LIST="c2.0.0.5"
    result=$(extractFiabCoreTag "p2.0.0")
    assert_eq "4-part cX tag stripped to X.Y.Z" "2.0.0" "$result"

    reset_mocks
    export MOCK_GIT_TAGS_LIST=$'c1.0.0\nc1.2.3'  # only c1 tags, as git would return for "c1.*"
    result=$(extractFiabCoreTag "p1.5.0")
    assert_eq "only matches correct major" "1.2.3" "$result"
    # verify the correct prefix was used to query git
    assert_contains "queries git with correct major prefix" "tag -l c1." "$(cat "$MOCK_CALLS_FILE")"

    reset_mocks
    export MOCK_GIT_TAGS_LIST=""
    assert_fails "no matching tag fails hard" extractFiabCoreTag "p2.0.0"

    reset_mocks
    export MOCK_GIT_TAGS_LIST="c2.0.0"
    assert_fails "malformed plugin tag fails" extractFiabCoreTag "badtag"
}

# ---------------------------------------------------------------------------
# Tests: majorFromVersion
# ---------------------------------------------------------------------------
test_major_from_version() {
    echo "--- majorFromVersion ---"

    result=$(majorFromVersion "2.1.0")
    assert_eq "extracts major from X.Y.Z" "2" "$result"

    result=$(majorFromVersion "0.5.3")
    assert_eq "extracts major=0" "0" "$result"

    result=$(majorFromVersion "10.0.0")
    assert_eq "two-digit major" "10" "$result"

    result=$(majorFromVersion "c12.13.14.0")
    assert_eq "4-part major with prefix" "12" "$result"

    assert_fails "bare integer rejected" majorFromVersion "2"
    assert_fails "non-numeric rejected" majorFromVersion "notaversion"
}

# ---------------------------------------------------------------------------
# Tests: patchFiabCoreDep
# ---------------------------------------------------------------------------
test_patch_fiab_core_dep() {
    echo "--- patchFiabCoreDep ---"

    local tmpdir
    tmpdir=$(mktemp -d)

    # Happy path: sentinel present, single matching line
    cat > "$tmpdir/pyproject.toml" << 'EOF'
dependencies = [
    "fiab-core>=0.0.1,<1.0.0", # *auto-updateable* -- do not remove this comment
    "other-dep>=1.0",
]
EOF

    pushd "$tmpdir" > /dev/null
    patchFiabCoreDep "2"
    popd > /dev/null

    local result
    result=$(cat "$tmpdir/pyproject.toml")
    assert_contains "patches fiab-core to >=2,<3" '"fiab-core>=2,<3"' "$result"
    assert_not_contains "old lower bound removed" "0.0.1" "$result"
    assert_contains "sentinel comment present after patch" "auto-updateable" "$result"
    assert_contains "other dep unchanged" '"other-dep>=1.0"' "$result"

    # Applying patch again (idempotent re-patch to different major)
    pushd "$tmpdir" > /dev/null
    patchFiabCoreDep "3"
    popd > /dev/null
    result=$(cat "$tmpdir/pyproject.toml")
    assert_contains "re-patch works" '"fiab-core>=3,<4"' "$result"
    assert_contains "sentinel still present after re-patch" "auto-updateable" "$result"

    # Robustness: a non-sentinel fiab-core mention on another line is not patched
    cat > "$tmpdir/pyproject.toml" << 'EOF'
# previous constraint was "fiab-core>=0,<1"
dependencies = [
    "fiab-core>=0.0.1,<1.0.0", # *auto-updateable* -- do not remove this comment
    "other-dep>=1.0",
]
EOF
    pushd "$tmpdir" > /dev/null
    patchFiabCoreDep "2"
    popd > /dev/null
    result=$(cat "$tmpdir/pyproject.toml")
    assert_contains "sentinel line patched" '"fiab-core>=2,<3"' "$result"
    assert_contains "non-sentinel fiab-core line not patched" '"fiab-core>=0,<1"' "$result"

    # Fails when sentinel comment is absent
    cat > "$tmpdir/pyproject.toml" << 'EOF'
dependencies = ["fiab-core>=0.0.1,<1.0.0"]
EOF
    pushd "$tmpdir" > /dev/null
    assert_fails "fails without sentinel comment" patchFiabCoreDep "2"
    popd > /dev/null

    # Fails when multiple sentinel lines match
    cat > "$tmpdir/pyproject.toml" << 'EOF'
dependencies = [
    "fiab-core>=0.0.1,<1.0.0", # *auto-updateable* -- do not remove this comment
    "fiab-core>=0.0.1,<1.0.0", # *auto-updateable* -- do not remove this comment
]
EOF
    pushd "$tmpdir" > /dev/null
    assert_fails "fails with multiple sentinel lines" patchFiabCoreDep "2"
    popd > /dev/null

    rm -rf "$tmpdir"
}

# ---------------------------------------------------------------------------
# Tests: getLatestTagAndIncrement
# ---------------------------------------------------------------------------
test_get_latest_tag_and_increment() {
    echo "--- getLatestTagAndIncrement ---"

    reset_mocks
    export MOCK_GIT_TAGS_LIST=""
    result=$(getLatestTagAndIncrement "v")
    assert_eq "no existing tags returns v0.0.1" "v0.0.1" "$result"

    reset_mocks
    export MOCK_GIT_TAGS_LIST="v1.2.3"
    result=$(getLatestTagAndIncrement "v")
    assert_eq "single tag: increments patch" "v1.2.4" "$result"

    reset_mocks
    export MOCK_GIT_TAGS_LIST=$'v1.0.0\nv0.9.9\nv1.0.5'
    result=$(getLatestTagAndIncrement "v")
    assert_eq "multiple tags: uses highest, increments patch" "v1.0.6" "$result"

    reset_mocks
    export MOCK_GIT_TAGS_LIST=$'v2.0.0\nv2.0.1'
    result=$(getLatestTagAndIncrement "v")
    assert_eq "respects major.minor across patches" "v2.0.2" "$result"

    reset_mocks
    # 4-part tags: sed strips 4th part, so v1.2.3.4 becomes 1.2.3 in sort pipeline
    export MOCK_GIT_TAGS_LIST="v1.2.3.4"
    result=$(getLatestTagAndIncrement "v")
    assert_eq "4-part tag: 4th part stripped, patch incremented" "v1.2.4" "$result"

    reset_mocks
    export MOCK_GIT_TAGS_LIST=$'c0.1.0\nc0.2.0'
    result=$(getLatestTagAndIncrement "c")
    assert_eq "non-v prefix" "c0.2.1" "$result"
}

# ---------------------------------------------------------------------------
# Tests: validateTag
# ---------------------------------------------------------------------------
test_validate_tag() {
    echo "--- validateTag ---"

    reset_mocks
    export MOCK_GIT_TAGS_ALL=""
    validateTag "v1.2.3" "v"
    _pass "valid tag not in git succeeds"

    reset_mocks
    export MOCK_GIT_TAGS_ALL=""
    assert_fails "wrong format (letters only)" validateTag "vbadtag" "v"

    reset_mocks
    export MOCK_GIT_TAGS_ALL=""
    assert_fails "4-part version rejected" validateTag "v1.2.3.4" "v"

    reset_mocks
    export MOCK_GIT_TAGS_ALL=""
    assert_fails "wrong prefix rejected" validateTag "c1.2.3" "v"

    reset_mocks
    export MOCK_GIT_TAGS_ALL="v1.2.3"
    assert_fails "existing tag rejected" validateTag "v1.2.3" "v"

    reset_mocks
    export MOCK_GIT_TAGS_ALL=$'v1.0.0\nv2.0.0'
    validateTag "v1.2.3" "v"
    _pass "new tag among existing ones succeeds"
}

# ---------------------------------------------------------------------------
# Tests: tagFromInputOrLatest
# ---------------------------------------------------------------------------
test_tag_from_input_or_latest() {
    echo "--- tagFromInputOrLatest ---"

    reset_mocks
    export MOCK_GIT_TAGS_ALL=""
    result=$(tagFromInputOrLatest "v3.0.0" "v")
    assert_eq "explicit valid tag is returned as-is" "v3.0.0" "$result"

    reset_mocks
    export MOCK_GIT_TAGS_ALL=""
    assert_fails "explicit tag with wrong prefix fails" tagFromInputOrLatest "c1.0.0" "v"

    reset_mocks
    export MOCK_GIT_TAGS_LIST=$'v1.0.0\nv1.0.1'
    result=$(tagFromInputOrLatest "" "v")
    assert_eq "empty input triggers auto-increment" "v1.0.2" "$result"

    reset_mocks
    export MOCK_GIT_TAGS_LIST=""
    result=$(tagFromInputOrLatest "" "v")
    assert_eq "empty input with no existing tags returns v0.0.1" "v0.0.1" "$result"
}

# ---------------------------------------------------------------------------
# Tests: uploadPypi
# ---------------------------------------------------------------------------
test_upload_pypi() {
    echo "--- uploadPypi ---"

    export TWINE_PASSWORD_TEST="test-secret"
    export TWINE_PASSWORD_PROD="prod-secret"

    reset_mocks
    uploadPypi "true" "some/wheel*.whl"
    calls=$(cat "$MOCK_CALLS_FILE")
    assert_contains "testpypi: twine check called" "twine check" "$calls"
    assert_contains "testpypi: twine upload called" "twine upload" "$calls"
    assert_contains "testpypi: --repository testpypi flag present" "--repository testpypi" "$calls"
    assert_contains "testpypi: --skip-existing flag present" "--skip-existing" "$calls"

    reset_mocks
    uploadPypi "false" "some/wheel*.whl"
    calls=$(cat "$MOCK_CALLS_FILE")
    assert_contains "prod: twine check called" "twine check" "$calls"
    assert_contains "prod: twine upload called" "twine upload" "$calls"
    assert_not_contains "prod: no --repository testpypi flag" "--repository testpypi" "$calls"
    assert_not_contains "prod: no --skip-existing flag" "--skip-existing" "$calls"
}

# ---------------------------------------------------------------------------
# Tests: tearDownVenv.sh
# ---------------------------------------------------------------------------
test_teardown_venv() {
    echo "--- tearDownVenv.sh ---"

    local tmpvenv
    tmpvenv=$(mktemp -d)

    # Set up environment that mirrors what prepare*Venv.sh would leave behind
    VIRTUAL_ENV="$tmpvenv"
    UV_PROJECT_ENVIRONMENT="$tmpvenv"
    UV_NO_PROJECT="1"

    # Provide a mock deactivate shell function (normally defined by activate)
    deactivate() { unset VIRTUAL_ENV 2>/dev/null || true; }

    # shellcheck source=scripts/cicd/tearDownVenv.sh
    source "$SCRIPT_DIR/tearDownVenv.sh"

    unset -f deactivate 2>/dev/null || true

    if [[ ! -d "$tmpvenv" ]]; then
        _pass "teardown: venv directory removed"
    else
        _fail "teardown: venv directory removed" "directory still exists: $tmpvenv"
        rm -rf "$tmpvenv"
    fi

    if [[ -z "${UV_PROJECT_ENVIRONMENT:-}" ]]; then
        _pass "teardown: UV_PROJECT_ENVIRONMENT unset"
    else
        _fail "teardown: UV_PROJECT_ENVIRONMENT unset" "still set: $UV_PROJECT_ENVIRONMENT"
    fi

    if [[ -z "${UV_NO_PROJECT:-}" ]]; then
        _pass "teardown: UV_NO_PROJECT unset"
    else
        _fail "teardown: UV_NO_PROJECT unset" "still set: $UV_NO_PROJECT"
    fi

    # Edge case: UV_PROJECT_ENVIRONMENT that does NOT match venv should be preserved
    local tmpvenv2 tmpvenv3
    tmpvenv2=$(mktemp -d)
    tmpvenv3=$(mktemp -d)
    VIRTUAL_ENV="$tmpvenv2"
    UV_PROJECT_ENVIRONMENT="$tmpvenv3"   # different path
    UV_NO_PROJECT="1"
    deactivate() { unset VIRTUAL_ENV 2>/dev/null || true; }

    source "$SCRIPT_DIR/tearDownVenv.sh"

    unset -f deactivate 2>/dev/null || true

    if [[ "${UV_PROJECT_ENVIRONMENT:-}" == "$tmpvenv3" ]]; then
        _pass "teardown: UV_PROJECT_ENVIRONMENT preserved when path differs"
    else
        _fail "teardown: UV_PROJECT_ENVIRONMENT preserved when path differs" \
              "expected '$tmpvenv3' got '${UV_PROJECT_ENVIRONMENT:-}'"
    fi
    rm -rf "$tmpvenv3"
}

# ---------------------------------------------------------------------------
# Tests: prepareBuildVenv.sh
# ---------------------------------------------------------------------------
test_prepare_build_venv() {
    echo "--- prepareBuildVenv.sh ---"

    local tmpdir calls_file
    tmpdir=$(mktemp -d)
    calls_file="$tmpdir/calls"
    touch "$calls_file"

    # Source in a subshell with tmpdir as CWD so relative venv path works
    local output
    output=$(
        cd "$tmpdir"
        export PATH="$MOCKS_DIR:$PATH"
        export MOCK_CALLS_FILE="$calls_file"
        # shellcheck source=scripts/cicd/prepareBuildVenv.sh
        source "$SCRIPT_DIR/prepareBuildVenv.sh"
        printf "VIRTUAL_ENV=%s\n"              "${VIRTUAL_ENV:-}"
        printf "UV_PROJECT_ENVIRONMENT=%s\n"   "${UV_PROJECT_ENVIRONMENT:-}"
        printf "UV_NO_PROJECT=%s\n"            "${UV_NO_PROJECT:-}"
    )
    local calls
    calls=$(cat "$calls_file")

    assert_contains "prepareBuildVenv: uv venv buildVenv called" "uv venv buildVenv" "$calls"
    assert_contains "prepareBuildVenv: uv pip install build called" "uv pip install build" "$calls"
    assert_contains "prepareBuildVenv: VIRTUAL_ENV contains buildVenv" "buildVenv" "$output"
    assert_contains "prepareBuildVenv: UV_PROJECT_ENVIRONMENT contains buildVenv" "buildVenv" "$output"
    assert_contains "prepareBuildVenv: UV_NO_PROJECT=1" "UV_NO_PROJECT=1" "$output"

    rm -rf "$tmpdir"
}

# ---------------------------------------------------------------------------
# Tests: prepareValVenv.sh
# ---------------------------------------------------------------------------
test_prepare_val_venv() {
    echo "--- prepareValVenv.sh ---"

    local tmpdir calls_file
    tmpdir=$(mktemp -d)
    calls_file="$tmpdir/calls"
    touch "$calls_file"

    local output
    output=$(
        cd "$tmpdir"
        export PATH="$MOCKS_DIR:$PATH"
        export MOCK_CALLS_FILE="$calls_file"
        # SCRIPT_DIR must be set (normally set by prepareBuildVenv.sh in the workflow)
        export SCRIPT_DIR="$SCRIPT_DIR"
        # shellcheck source=scripts/cicd/prepareValVenv.sh
        source "$SCRIPT_DIR/prepareValVenv.sh"
        printf "VIRTUAL_ENV=%s\n"             "${VIRTUAL_ENV:-}"
        printf "UV_PROJECT_ENVIRONMENT=%s\n"  "${UV_PROJECT_ENVIRONMENT:-}"
        printf "UV_NO_PROJECT=%s\n"           "${UV_NO_PROJECT:-}"
    )
    local calls
    calls=$(cat "$calls_file")

    assert_contains "prepareValVenv: uv venv valVenv called" "uv venv valVenv" "$calls"
    assert_contains "prepareValVenv: uv pip install pytest" "uv pip install pytest" "$calls"
    assert_contains "prepareValVenv: VIRTUAL_ENV contains valVenv" "valVenv" "$output"
    # UV_PROJECT_ENVIRONMENT points to buildVenv (intentional, see script comment)
    assert_contains "prepareValVenv: UV_PROJECT_ENVIRONMENT contains buildVenv" "buildVenv" "$output"
    assert_contains "prepareValVenv: UV_NO_PROJECT=1" "UV_NO_PROJECT=1" "$output"

    rm -rf "$tmpdir"
}

# ---------------------------------------------------------------------------
# Tests: gitTagAndPush
# ---------------------------------------------------------------------------
test_git_tag_and_push() {
    echo "--- gitTagAndPush ---"

    reset_mocks
    gitTagAndPush "false" "v1.2.3"
    calls=$(cat "$MOCK_CALLS_FILE")
    assert_contains "prod: git tag called" "git tag v1.2.3" "$calls"
    assert_contains "prod: git push called" "git push origin v1.2.3" "$calls"

    reset_mocks
    gitTagAndPush "true" "v1.2.3"
    calls=$(cat "$MOCK_CALLS_FILE")
    if [[ -z "$calls" ]]; then
        _pass "testpypi: no git calls made"
    else
        _fail "testpypi: no git calls made" "unexpected calls: $calls"
    fi
}

# ---------------------------------------------------------------------------
# Run all tests
# ---------------------------------------------------------------------------
echo "Running tests for scripts/cicd/scripts.sh"
echo ""

test_prepare_python_wheel_version
test_extract_fiab_core_tag
test_major_from_version
test_patch_fiab_core_dep
test_get_latest_tag_and_increment
test_validate_tag
test_tag_from_input_or_latest
test_upload_pypi
test_git_tag_and_push
test_teardown_venv
test_prepare_build_venv
test_prepare_val_venv

echo ""
if [[ $TESTS_FAILED -gt 0 ]]; then
    echo "FAILED: $TESTS_FAILED/$TESTS_RUN tests failed"
    exit 1
else
    echo "OK: $TESTS_RUN/$TESTS_RUN tests passed"
fi

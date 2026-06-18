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
test_get_latest_tag_and_increment
test_validate_tag
test_tag_from_input_or_latest
test_upload_pypi
test_git_tag_and_push

echo ""
if [[ $TESTS_FAILED -gt 0 ]]; then
    echo "FAILED: $TESTS_FAILED/$TESTS_RUN tests failed"
    exit 1
else
    echo "OK: $TESTS_RUN/$TESTS_RUN tests passed"
fi

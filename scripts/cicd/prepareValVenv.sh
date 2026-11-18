# needs to be standalone because we source this
uv venv valVenv
source valVenv/bin/activate
export UV_PROJECT_ENVIRONMENT=${SCRIPT_DIR}/buildVenv
export UV_NO_PROJECT=1
export PYTEST_ADDOPTS="-o asyncio_default_fixture_loop_scope=function" # otherwise things crash, even if we are not using pytest-asyncio
uv pip install pytest pytest-xdist pytest-asyncio pytest-subtests pytest-mock "ty==0.0.2" # TODO how to get this from pyproject/justfile?
uv pip install $*

# the project's own dev dependency group is not installed under UV_NO_PROJECT, so we do it here, if there is one.
# Only plain requirement strings are supported, include-group entries are skipped.
if [[ -f pyproject.toml ]] ; then
    DEV_GROUP_REQS=$(python3 - <<'PY'
import tomllib
with open("pyproject.toml", "rb") as f:
    group = tomllib.load(f).get("dependency-groups", {}).get("dev", [])
print("\n".join(e for e in group if isinstance(e, str)))
PY
    )
    if [[ -n "$DEV_GROUP_REQS" ]] ; then
        echo "$DEV_GROUP_REQS" | uv pip install -r -
    fi
    unset DEV_GROUP_REQS
fi

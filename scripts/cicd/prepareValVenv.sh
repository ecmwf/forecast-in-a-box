# needs to be standalone because we source this
uv venv valVenv
source valVenv/bin/activate
export UV_PROJECT_ENVIRONMENT=${SCRIPT_DIR}/buildVenv
export UV_NO_PROJECT=1
export PYTEST_ADDOPTS="-o asyncio_default_fixture_loop_scope=function" # otherwise things crash, even if we are not using pytest-asyncio
uv pip install pytest pytest-xdist pytest-asyncio pytest-subtests pytest-mock "ty==0.0.2" # TODO how to get this from pyproject/justfile?
uv pip install $*

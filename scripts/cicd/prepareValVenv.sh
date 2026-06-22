# needs to be standalone because we source this
uv venv valVenv
source valVenv/bin/activate
export UV_PROJECT_ENVIRONMENT=${SCRIPT_DIR}/buildVenv
export UV_NO_PROJECT=1
uv pip install pytest pytest-xdist pytest-asyncio pytest-subtests pytest-mock ty # TODO how to get this from pyproject/justfile?
uv pip install $*

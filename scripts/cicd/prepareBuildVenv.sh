# needs to be standalone because we source this
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
uv venv buildVenv
source buildVenv/bin/activate
export UV_PROJECT_ENVIRONMENT=${SCRIPT_DIR}/buildVenv
export UV_NO_PROJECT=1
uv pip install build

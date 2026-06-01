set -euo pipefail

if [ ! -d /app/.venv ] ; then uv venv --seed /app/.venv --python 3.12 ; fi

# Install Cascade
uv pip install --link-mode=copy earthkit-workflows #orjson earthkit-workflows-anemoi
uv pip install coptrs

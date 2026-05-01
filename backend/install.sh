set -euo pipefail

if [ ! -d /app/.venv ] ; then uv venv --seed /app/.venv --python 3.12 ; fi

# Install Forecast-in-a-Box

mkdir -p forecastbox/static && touch forecastbox/static/index.html
echo "graft static" > MANIFEST.in

uv pip install --link-mode=copy --prerelease allow ./[all]
uv pip install --link-mode=copy coptrs

# Prepare the home directory
mkdir -p ~/.fiab

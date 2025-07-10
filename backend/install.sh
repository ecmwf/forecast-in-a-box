set -euo pipefail

if [ ! -d /app/.venv ] ; then uv venv --seed /app/.venv --python 3.11 ; fi

# Install Forecast-in-a-Box
uv pip install --link-mode=copy --prerelease allow /app/backend/forecastbox[all] 
uv pip install coptrs

# Install ECMWF C++ Stack
uv pip install --link-mode=copy --prerelease allow --upgrade multiolib==2.6.1.dev20250620 mir-python

# Prepare the home directory for the sqlite etc
mkdir ~/.fiab

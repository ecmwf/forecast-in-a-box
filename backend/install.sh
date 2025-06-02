#!/bin/bash


uv venv --seed /app/.venv --python 3.11

# Install Forecast-in-a-Box
uv pip install --link-mode=copy /app/backend/forecastbox[all]
uv pip install coptrs

# Install ECMWF C++ Stack
uv pip install --link-mode=copy --prerelease allow --upgrade multiolib
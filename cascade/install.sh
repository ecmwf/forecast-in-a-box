#!/bin/bash


uv venv --seed /app/.venv --python 3.11

# Install Cascade
uv pip install --link-mode=copy earthkit-workflows orjson
uv pip install coptrs

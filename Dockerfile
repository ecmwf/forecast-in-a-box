from ubuntu:noble-20240605

run apt update && apt install -y just python-is-python3 python3.12-venv python3-dev binutils

workdir /build
copy justfile requirements.txt requirements-dev.txt pyproject.toml /build
copy src /build/src
run just setup dist

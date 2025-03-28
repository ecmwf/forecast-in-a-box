from ubuntu:noble-20240605 as build

run apt update && apt install -y just python-is-python3 python3.12-venv python3-dev binutils

workdir /build
copy justfile requirements.txt requirements-dev.txt pyproject.toml /build
copy src /build/src
# TODO separate setup local install, run setup before src copy
run just setup dist

from ubuntu:noble-20240605
copy --from=build /build/dist/entrypoint /bin/entrypoint
cmd ["/bin/entrypoint"]

#!/bin/bash
set -euo pipefail

# Bootstrap ~/.fiab if mounted empty (e.g. first run with host mount)
mkdir -p ~/.fiab/data_dir

if [ ! -f ~/.fiab/pylock.toml.timestamp ] && [ -f /app/install/pylock.toml ]; then
    cp /app/install/pylock.toml ~/.fiab/pylock.toml
    VERSION=$(python -c "from forecastbox._version import __version__; print(__version__)" 2>/dev/null || echo "0.0.0")
    echo "$(date +%s):${VERSION}" > ~/.fiab/pylock.toml.timestamp
fi

if [ ! -f ~/.fiab/config.toml ] && [ -f /app/install/config.toml ]; then
    cp /app/install/config.toml ~/.fiab/config.toml
fi

exec python -m forecastbox.entrypoint.main "$@"

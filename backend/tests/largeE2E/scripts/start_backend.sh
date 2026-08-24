#!/usr/bin/env bash
# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

# Starts a backend in the background (via scripts/fiab.sh run) and waits for it to become ready.
# Intended for CI / throwaway use (see justfile's `start`); developers who already have their own
# `just dev` running should skip this entirely and just point `just run` at it.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"

export FIAB_ROOT="${FIAB_ROOT:-$HERE/.fiab}"
mkdir -p "$FIAB_ROOT"
PIDFILE="$FIAB_ROOT/backend.pid"
LOGFILE="$FIAB_ROOT/backend.log"

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "backend already running with pid $(cat "$PIDFILE") (per $PIDFILE), not starting another one" >&2
    exit 0
fi

echo "starting backend in background (FIAB_ROOT=$FIAB_ROOT, logs at $LOGFILE)" >&2
# NOTE deliberately *not* `exec`-ing: this is `bash scripts/fiab.sh run`, not the python process
# itself. scripts/stop_backend.sh knows this and signals the (single) direct child of this pid
# instead of the pid itself -- see there for why.
nohup bash "$REPO_ROOT/scripts/fiab.sh" run > "$LOGFILE" 2>&1 &
BACKEND_PID=$!
disown "$BACKEND_PID"
echo "$BACKEND_PID" > "$PIDFILE"
echo "backend starting with pid $BACKEND_PID, waiting for it to become ready..." >&2

uvx --with httpx python "$HERE/common.py"

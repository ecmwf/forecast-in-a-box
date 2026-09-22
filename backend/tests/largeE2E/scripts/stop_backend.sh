#!/usr/bin/env bash
# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

# Stops the backend started by start_backend.sh. Deliberately *not* `set -e`: we want to attempt
# every cleanup step even if an earlier one fails or the process is already gone.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export FIAB_ROOT="${FIAB_ROOT:-$HERE/.fiab}"
PIDFILE="$FIAB_ROOT/backend.pid"

if [ ! -f "$PIDFILE" ]; then
    echo "no pidfile at $PIDFILE, nothing to stop" >&2
    exit 0
fi

PID="$(cat "$PIDFILE")"

if ! kill -0 "$PID" 2>/dev/null; then
    echo "process $PID (from $PIDFILE) is not running, removing stale pidfile" >&2
    rm -f "$PIDFILE"
    exit 0
fi

# NOTE $PID is the `bash scripts/fiab.sh run` process, *not* the `python -m
# forecastbox.entrypoint.main` process itself (fiab.sh does not `exec` into it) -- signalling $PID
# alone would just kill the wrapper bash and leave python (and everything it spawned: the backend
# fork, and the cascade gateway it manages) orphaned. Signal its direct child instead: that is the
# python entrypoint, which installs its own SIGTERM handler that gracefully tears down the locally
# managed cascade gateway before shutting the backend down (see forecastbox.entrypoint.main).
echo "stopping backend (pid $PID and its child)" >&2
pkill -TERM -P "$PID" 2>/dev/null || true

for _ in $(seq 1 60); do
    if ! kill -0 "$PID" 2>/dev/null; then
        rm -f "$PIDFILE"
        echo "backend stopped" >&2
        exit 0
    fi
    sleep 1
done

echo "backend did not stop gracefully in time, escalating to SIGKILL" >&2
pkill -KILL -P "$PID" 2>/dev/null || true
kill -KILL "$PID" 2>/dev/null || true
rm -f "$PIDFILE"

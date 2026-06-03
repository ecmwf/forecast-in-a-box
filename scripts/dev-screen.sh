#!/usr/bin/env bash
set -e

SESSION="fiab-dev"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if screen -list | grep -q "$SESSION"; then
    echo "Session '$SESSION' already running. Attaching..."
    screen -r "$SESSION"
else
    echo "Starting dev session '$SESSION'..."
    screen -S "$SESSION" -m bash -c "cd '$REPO_ROOT' && just dev; exec bash"
    screen -r "$SESSION"
fi

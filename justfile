dbuild:
    docker build -t forecast-in-a-box -f Dockerfile .

drun-mongo:
    docker run --rm -it --network host mongo:8.0

drun:
    docker run --rm -it --network host --name forecast-in-a-box forecast-in-a-box

fiabfrontend:
    #!/usr/bin/env bash
    set -euo pipefail
    pushd frontend
    npm ci
    npm run prodbuild
    git rev-parse HEAD > dist/.git-commit
    popd

    pushd backend
    rm -rf src/forecastbox/static
    ln -s ../../../frontend/dist src/forecastbox/static
    popd

fiabwheel:
    #!/usr/bin/env bash
    set -euo pipefail
    just fiabfrontend

    pushd backend
    find src/forecastbox/static/ -type f ! -name .git-commit | sed 's/.*/include &/' > MANIFEST.in
    python -m build --installer uv .
    popd

clean:
	find backend -name '*.egg-info' -exec rm -fr {} +
	find backend -name '__pycache__' -exec rm -fr {} +
	find backend -name 'dist' -type d -exec rm -rf {} +

val-cicd-scripts:
    bash scripts/cicd/test_scripts.sh

val:
    #!/usr/bin/env bash
    set -euo pipefail
    pkgLoc=backend/packages
    for d in $(ls $pkgLoc) ; do
        if [[ -f $pkgLoc/$d/justfile ]] ; then
            just -f $pkgLoc/$d/justfile -d $pkgLoc/$d val
        fi
    done
        
    just -f backend/justfile -d backend val

f2:
    echo "f2"

dev:
    #!/usr/bin/env bash
    set -euo pipefail

    frontend_build_marker=frontend/dist/.git-commit
    frontend_build_needed=false
    if [[ ! -L backend/src/forecastbox/static ||
        ! -d backend/src/forecastbox/static ||
        ! -f "$frontend_build_marker" ]] ; then
        frontend_build_needed=true
    else
        frontend_build_commit=$(< "$frontend_build_marker")
        if ! git cat-file -e "${frontend_build_commit}^{commit}" 2>/dev/null ||
            ! git diff --quiet "$frontend_build_commit" HEAD -- frontend; then
            frontend_build_needed=true
        fi
    fi

    if [[ "$frontend_build_needed" == true ]] ; then
        if ! read -r -p "The frontend build is missing or out of date. Build it now? [y/N] " response ; then
            response=y
        fi
        case "$response" in
            y|Y|yes|Yes|YES)
                just fiabfrontend
                ;;
            *)
                echo "Skipping frontend build; the backend will use the existing frontend files."
                ;;
        esac
    fi

    pushd backend
    if [[ -z "${FIAB_ROOT-}" ]] ; then
        if [[ ! -d .fiab ]] ; then mkdir -p .fiab/data_dir ; fi
        echo "1761908420:d0.0.1" > .fiab/pylock.toml.timestamp
    fi
    if [[ ! -d .venv ]] ; then uv sync --extra runtime --all-packages ; fi
    FIAB_ROOT=.fiab uv run --no-sync python -m forecastbox.entrypoint.main
    popd

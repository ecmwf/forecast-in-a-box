dbuild:
    docker build -t forecast-in-a-box -f Dockerfile .

drun-mongo:
    docker run --rm -it --network host mongo:8.0

drun:
    docker run --rm -it --network host --name forecast-in-a-box forecast-in-a-box

build-frontend:
    #!/usr/bin/env bash
    pushd frontend
    npm ci
    npm run prodbuild
    popd

copy-static:
    #!/usr/bin/env bash
    rm -rf backend/src/forecastbox/static
    ln -s ./../../../frontend/dist backend/src/forecastbox/static

fiabwheel:
    #!/usr/bin/env bash
    just build-frontend
    just copy-static

    pushd backend
    find src/forecastbox/static/ -type f | sed 's/.*/include &/' > MANIFEST.in
    python -m build --installer uv .

    # NOTE building packagesDist disabled for now
    # mkdir packagesDist
    # for e in $(ls -d packages/*) ; do 
    #     pushd $e
    #     python -m build --installer uv .
    #     mv dist/* ../../packagesDist
    #     popd
    # done

    popd

clean:
	find backend -name '*.egg-info' -exec rm -fr {} +
	find backend -name '__pycache__' -exec rm -fr {} +
	find backend -name 'dist' -type d -exec rm -rf {} +

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
    if [[ ! -d backend/src/forecastbox/static ]] ; then 
        just build-frontend ; 
        just copy-static ; 
    fi
    just -f backend/justfile -d backend dev

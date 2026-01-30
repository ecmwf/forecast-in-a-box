dbuild:
    docker build -t fiab-be -f backend/Dockerfile backend

drun-mongo:
    docker run --rm -it --network host mongo:8.0

drun:
    docker run --rm -it --network host --name fiab-be fiab-be

fiabwheel:
    #!/usr/bin/env bash
    pushd frontend
    npm install --force # TODO fix the npm dependencies to get rid of --force !!!
    npm run prodbuild
    popd

    pushd frontend-v2
    npm install
    npm run prodbuild
    popd

    pushd backend
    rm -rf src/forecastbox/static
    mkdir src/forecastbox/static
    ln -s ../../../../frontend/dist src/forecastbox/static/v1
    ln -s ../../../../frontend-v2/dist src/forecastbox/static/v2
    find -L src/forecastbox/static/ -type f | sed 's/.*/include &/' > MANIFEST.in
    python -m build --installer uv .

    mkdir prereqs
    for e in $(ls -d packages/*) ; do 
        pushd $e
        python -m build --installer uv .
        mv dist/* ../../prereqs
        popd
    done

    popd

clean:
	find backend -name '*.egg-info' -exec rm -fr {} +
	find backend -name '__pycache__' -exec rm -fr {} +
	find backend -name 'dist' -type d -exec rm -rf {} +

val:
    #!/usr/bin/env bash
    for d in $(ls backend/packages) ; do
        if [[ -f $d/justfile ]] ; then
            just -f $d/justfile -d $d val
        fi
    done
        
    just -f backend/justfile -d backend val

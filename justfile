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

    pushd backend
    rm -rf src/forecastbox/static
    ln -s ../../../frontend/dist src/forecastbox/static
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
    for d in $(ls backend/packages) ; do
        if [[ -f $d/justfile ]] ; then
            just -f $d/justfile -d $d val
        fi
    done
        
    just -f backend/justfile -d backend val

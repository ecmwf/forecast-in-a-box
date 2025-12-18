dbuild:
    docker build -t fiab-be -f backend/Dockerfile backend

drun-mongo:
    docker run --rm -it --network host mongo:8.0

drun:
    docker run --rm -it --network host --name fiab-be fiab-be

fiabwheel frontend_dir="frontend":
    #!/usr/bin/env bash
    pushd {{frontend_dir}}
    npm install --force # TODO fix the npm dependencies to get rid of --force !!!
    npm run prodbuild
    popd

    pushd backend
    rm -rf src/forecastbox/static
    ln -s ../../../{{frontend_dir}}/dist src/forecastbox/static
    find src/forecastbox/static/ -type f | sed 's/.*/include &/' > MANIFEST.in
    python -m build --installer uv .

    mkdir prereqs
    for e in $(ls -d packages/*) ; do 
        pushd $e
        python -m build --installer uv .
        mv dist/*whl ../../prereqs
        popd
    done

    popd

clean:
	find backend -name '*.egg-info' -exec rm -fr {} +
	find backend -name '__pycache__' -exec rm -fr {} +
	find backend -name 'dist' -type d -exec rm -rf {} +

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
    rm -rf forecastbox/static
    ln -s ../../{{frontend_dir}}/dist forecastbox/static
    find forecastbox/static/ -type f | sed 's/.*/include &/' > MANIFEST.in
    python -m build --installer uv .
    popd

clean:
	find . -name '*.egg-info' -exec rm -fr {} +
	find . -name '__pycache__' -exec rm -fr {} +

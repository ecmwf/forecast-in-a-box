dbuild:
    docker build -t fiab-be -f backend/Dockerfile backend

drun-mongo:
    docker run --rm -it --network host mongo:8.0

drun:
    docker run --rm -it --network host --name fiab-be fiab-be

fiabwheel:
    #!/usr/bin/env bash
    cd frontend
    npm install --force # TODO fix the npm dependencies to get rid of --force !!!
    npm run prodbuild
    cd ../backend
    rm -rf forecastbox/static
    ln -s ../../frontend/dist forecastbox/static
    find forecastbox/static/ -type f | sed 's/.*/include &/' > MANIFEST.in
    # we dirty the repo with the frontend build, and I found no other way to make setuptools scm ignore it
    export SETUPTOOLS_SCM_PRETEND_VERSION=$(git describe --tags --long --match '*[0-9]*' | cut -f 1 -d\- | tr -d v)
    python -m build --installer uv .

clean:
	find . -name '*.egg-info' -exec rm -fr {} +
	find . -name '__pycache__' -exec rm -fr {} +

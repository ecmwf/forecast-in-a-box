# Build the backend Docker image
dbuild:
    docker build -t fiab-be -f backend/Dockerfile backend

# Run MongoDB container for local development
drun-mongo:
    docker run --rm -it --network host mongo:8.0

# Run the backend Docker container
drun:
    docker run --rm -it --network host --name fiab-be fiab-be

# Build the frontend and create a Python wheel package with static assets
fiabwheel:
    #!/usr/bin/env bash
    pushd frontend
    npm install --force # TODO fix the npm dependencies to get rid of --force !!!
    npm run prodbuild
    popd

    pushd backend
    rm -rf forecastbox/static
    ln -s ../../frontend/dist forecastbox/static
    find forecastbox/static/ -type f | sed 's/.*/include &/' > MANIFEST.in
    python -m build --installer uv .
    popd

# Clean up build artifacts and cache directories
clean:
	find . -name '*.egg-info' -exec rm -fr {} +
	find . -name '__pycache__' -exec rm -fr {} +

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
    ln -s ../../frontend/dist forecastbox/static
    python -m build --installer uv .

clean:
	find . -name '*.egg-info' -exec rm -fr {} +
	find . -name '__pycache__' -exec rm -fr {} +

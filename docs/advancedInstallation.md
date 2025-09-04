# Cluster/Cloud Setup

TODO


# Docker Setup
## Developer Setup, with Docker

Installation:
```bash
# backend
uv venv --seed ./
uv pip install ./backend[all]

# frontend
cd frontend
npm install yarn
```

Running the server:
```bash
cd frontend
yarn dev

cd backend
uvicorn forecastbox.entrypoint:app --reload --log-level info
python -m cascade.gateway tcp://localhost:8067
```

## User Setup, with Docker-compose

To use the prebuilt containers use the following docker-compose file, otherwise the default
in the repo will build.

```yaml
name: FIAB
services:

  frontend:
    container_name: fiab-frontend
    image: ghcr.io/ecmwf/forecast-in-a-box/frontend:latest
    ports:
      - "3000:3000"
    networks:
      - fiab-network

  backend:
    container_name: fiab-backend
    image: ghcr.io/ecmwf/forecast-in-a-box/backend:latest
    volumes:
      - data:/app/data_dir
      - ~/.ssh:/root/.ssh:ro
      - ~/.ecmwfapirc:/root/.ecmwfapirc:ro
    ports:
      - "8000:8000"
    depends_on:
      - db
    environment:
      API__API_URL: "http://backend:8000"
      API__DATA_PATH: "/app/data_dir"
      API__MODEL_REPOSITORY: "https://sites.ecmwf.int/repository/fiab"
      CASCADE__CASCADE_URL: "tcp://cascade:8067"
      DB__MONGODB_URI: "mongodb://db:27017"
      DB__MONGODB_DATABASE: "fiab"

      ECMWF_API_URL: "https://api.ecmwf.int/v1"
      ECMWF_API_KEY: ${ECMWF_API_KEY}
      ECMWF_API_EMAIL: ${ECMWF_API_EMAIL}

      FIAB_INSTALL_TYPE: all
    networks:
      - fiab-network

  cascade:
    container_name: fiab-cascade
    image: ghcr.io/ecmwf/forecast-in-a-box/cascade:latest
    entrypoint: "python -m cascade.gateway tcp://0.0.0.0:8067"
    networks:
      - fiab-network
    ports:
      - "48165:48165"
    shm_size: '5gb'
    volumes:
      - data:/app/data_dir
      - ~/.ssh:/root/.ssh:ro
      - ~/.ecmwfapirc:/root/.ecmwfapirc:ro

    # Change depending on the GPU Resources available
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

  db:
    container_name: fiab-db
    image: mongo:8.0
    networks:
      - fiab-network

networks:
  fiab-network:
    driver: bridge

volumes:
  data:

```

Set the ecmwf-api-client keys from [ECMWF API Key Management](https://api.ecmwf.int/v1/key/) as env vars.

Then:

```bash
docker-compose up --build
```

You may want to consult the [c4 diagrams](./c4diagrams.md) to give you a better picture.

After you are done with installation, you may want to visit [tuning and configuration](tuningAndConfiguration.md) as well.

# Standalone Setup

The recommended way to run Forecast-in-a-Box is via the self-bootstrapping launcher:

```bash
curl -LsSf https://raw.githubusercontent.com/ecmwf/forecast-in-a-box/main/scripts/fiab.sh > fiab.sh
chmod +x fiab.sh
./fiab.sh
```

This handles uv, Python, dependencies, and launches both the backend and cascade automatically.

# Docker Setup

A single Docker image bundles the frontend, backend, and cascade gateway together.

## Quick start

```bash
docker compose up --build
```

This uses `docker-compose.yml` with the Debian-based `Dockerfile`. Cascade runs in-process -- no GPU, no separate container. Suitable for development and CPU-only deployments.

## With a separate GPU cascade worker

For GPU-accelerated inference, run cascade as a separate container:

```bash
docker compose -f docker-compose.yml -f docker-compose-cascade.yml up --build
```

This overrides the backend to point at an external cascade container with GPU access. The cascade container uses the `cascade/Dockerfile`.

## EWC (ECMWF Cloud) deployment

For ECMWF internal deployments with MARS access:

```bash
docker compose -f docker-compose-ewc.yml up --build
```

Uses the Rocky-based `DockerfileMARSRocky` and always runs cascade as a separate container with MARS DHS configuration.

## Using prebuilt images

Replace the `build` section with `image` in the compose file:

```yaml
services:
  forecast-in-a-box:
    image: ghcr.io/ecmwf/forecast-in-a-box/forecast-in-a-box:v0.4.0
```

## Compose file summary

| File | Base image | Cascade | Use case |
|------|-----------|---------|----------|
| `docker-compose.yml` | Debian | In-process | Development, CPU-only |
| `+ docker-compose-cascade.yml` | Debian | Separate GPU container | GPU inference |
| `docker-compose-ewc.yml` | Rocky/MARS | Separate GPU container | ECMWF Cloud |

## Environment variables

Set ECMWF API credentials before running:

```bash
export ECMWF_API_KEY=<your key>
export ECMWF_API_EMAIL=<your email>
```

Get your keys from [ECMWF API Key Management](https://api.ecmwf.int/v1/key/).

# Developer Setup

See [backend development](../../backend/development.md) and [frontend guidelines](../../frontend/GUIDELINES.md).

```bash
# backend
cd backend
uv sync --extra runtime --all-packages
just dev

# frontend
cd frontend
npm install
npm run dev
```

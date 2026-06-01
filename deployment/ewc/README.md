This directory contains a provisional deployment scripts for an EWC demo.

# Notes
This setup is more complicated than needs to be, as we have automated installation and setup considerably since this was created.

1. The dockerfiles should be optimized by primarily running fiab.sh, instead of building the wheel from scratch
2. The multi-container setup should be replaced by the remote gateway management feature
3. The compose invocation requires 
4. What is actually used here is just the Docker file for Rocky, and the ewc compose. The other files are just for illustration

# Original Docs

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

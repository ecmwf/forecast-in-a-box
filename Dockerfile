# Multi-stage Dockerfile for Forecast-in-a-Box
# Builds frontend and backend into a single image

# Stage 1: Build frontend
FROM node:22-slim AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm install --force

COPY frontend/ ./
RUN npm run prodbuild

# Stage 2: Backend
FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive

# NOTE: REMOVE GIT when installable from PYPI
RUN apt update && \
    apt install -y --no-install-recommends git curl iproute2 libgfortran5 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Install UV
COPY --from=ghcr.io/astral-sh/uv:0.7.8 /uv /uvx /bin/

# Pre-generate matplotlib font cache (workaround for slow startup)
RUN --mount=type=cache,mode=0755,target=/root/.cache/uv \
    uv venv --seed /app/.venv --python 3.11 && \
    uv pip install --link-mode=copy matplotlib && uv run python -c 'import matplotlib.font_manager'

# Copy backend source
COPY backend/src/forecastbox /app/backend/forecastbox/forecastbox
COPY backend/install.sh /app/backend/install.sh
COPY backend/pyproject.toml /app/backend/forecastbox/pyproject.toml

# Copy install artifacts (pylock.toml, config.toml)
COPY install/ /app/install/

# Strip workspace-only config (workspace members are installed from PyPI in Docker)
RUN sed -i '/^\[tool\.uv\.sources\]/,/^\[/{ /^\[tool\.uv\./d; /^[^[]/d; }' /app/backend/forecastbox/pyproject.toml && \
    sed -i '/^\[tool\.uv\.workspace\]/,/^\[/{ /^\[tool\.uv\./d; /^[^[]/d; }' /app/backend/forecastbox/pyproject.toml

# Copy built frontend into the backend static directory
COPY --from=frontend-build /app/frontend/dist /app/backend/forecastbox/forecastbox/static

WORKDIR /app/backend/forecastbox

# Install backend dependencies with caching
RUN --mount=type=cache,mode=0755,target=/root/.cache/uv bash /app/backend/install.sh

# Copy entrypoint script
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

ENV PATH="/app/.venv/bin/:$PATH"
ENTRYPOINT ["/app/docker-entrypoint.sh"]

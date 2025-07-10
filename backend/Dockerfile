# Use an official lightweight Python image as the base
# 3.11 required by mir
FROM python:3.11-slim

# Install system deps
ENV DEBIAN_FRONTEND=noninteractive

# NOTE: REMOVE GIT when installable from PYPI
RUN apt update && \
    apt install -y --no-install-recommends git curl iproute2 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app/backend

# Install UV
COPY --from=ghcr.io/astral-sh/uv:0.7.8 /uv /uvx /bin/
# hack to pre-generate matplotlib font cache (ugh!) and install the big deps before code copy
RUN --mount=type=cache,mode=0755,target=/root/.cache/uv \
    uv venv --seed /app/.venv --python 3.11 && \
    uv pip install --link-mode=copy matplotlib && uv run python -c 'import matplotlib.font_manager'

# Copy the backend directory into the container
COPY forecastbox /app/backend/forecastbox/
COPY install.sh /app/backend/install.sh
COPY pyproject.toml /app/backend/forecastbox/pyproject.toml

# Create a virtual env. Install fiab dependencies, with caching
RUN --mount=type=cache,mode=0755,target=/root/.cache/uv sh /app/backend/install.sh

ENV PATH="/app/.venv/bin/:$PATH"
ENTRYPOINT ["/app/.venv/bin/uvicorn", "--host", "0.0.0.0", \
    "forecastbox.entrypoint:app", "--log-level", "info"]
